// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { PositionPlanner } from "@uniswap/liquidity-launcher/src/libraries/PositionPlanner.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import {
    CurrencyAmounts,
    Plan,
    Position,
    PositionDefinition
} from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";
import { LiquidityGrowthAutomationV1 } from "./LiquidityGrowthAutomationV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "./LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthRangeSourceFactoryV1 } from "./LiquidityGrowthRangeSourceFactoryV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "./LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthVaultFactoryV1 } from "./LiquidityGrowthVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "./LiquidityGrowthVaultV1.sol";
import { ILiquidityGrowthOracleV1 } from "./interfaces/ILiquidityGrowthOracleV1.sol";

/// @title LiquidityGrowthLaunchV1
/// @notice Atomically launches a fixed-supply token with an immutable reserve for LiquidityGrowth.
/// @dev This launcher is deliberately absent from all production release manifests. It reuses the pinned UERC20,
///      Uniswap PositionPlanner, PositionManager, composite fee-oracle hook and deterministic vault factories.
///      The payable launch spends exactly its own `msg.value`; `_executeInitialBuy` proves the residual balance is
///      unchanged, so forced ETH is preserved but no launch payment can become contract custody.
// slither-disable-next-line locked-ether
contract LiquidityGrowthLaunchV1 is IUnlockCallback, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for *;
    using SafeERC20 for IERC20;

    uint8 public constant TOKEN_DECIMALS = 18;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    uint256 public constant MAX_TOKEN_NAME_BYTES = 48;
    uint256 public constant MAX_TOKEN_SYMBOL_BYTES = 12;
    uint256 public constant MAX_TOKEN_DESCRIPTION_BYTES = 280;
    uint256 public constant MAX_METADATA_URL_BYTES = 2048;
    uint256 public constant MAX_SOCIAL_EXTRA_DATA_BYTES = 1200;
    int24 public constant INITIAL_TICK = 204_200;
    int24 public constant TICK_SPACING = 200;
    uint24 public constant LP_FEE_PIPS = 0;
    uint32 private constant TWAP_WINDOW = 30 minutes;
    int24 private constant MAX_ABS_TICK_DELTA = 400;
    int24 private constant MAX_SPOT_TWAP_DEVIATION_TICKS = 600;
    int24 private constant ACTIVE_RANGE_HALF_WIDTH_TICKS = 20_000;
    uint64 private constant COMPOUND_COOLDOWN_SECONDS = 5 minutes;
    uint256 private constant COMPOUND_TARGET_DIVISOR = 40;
    uint256 private constant COMPOUND_NATIVE_CAP = 0.25 ether;
    uint24 private constant POSITION_WEIGHT = 10_000_000;
    // Slither 0.11.5 cannot build IR for unlockCallback and consequently misses the native settlement use.
    // slither-disable-next-line unused-state
    Currency private constant NATIVE = Currency.wrap(address(0));

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    UERC20Factory private immutable tokenFactory;
    LiquidityGrowthFeeOracleHookV1 public immutable feeHook;
    FeeSplitVaultFactoryV1 private immutable feeSplitVaultFactory;
    LiquidityGrowthRangeSourceFactoryV1 private immutable rangeSourceFactory;
    LiquidityGrowthVaultFactoryV1 private immutable growthVaultFactory;
    LiquidityGrowthAutomationV1 public immutable automation;
    LockedPositionFeeForwarderFactoryV1 private immutable positionForwarderFactory;

    mapping(address token => bytes32 launchHash) public launchHashOf;
    mapping(address token => address growthVault) public growthVaultOf;

    struct GrowthParameters {
        uint256 nativeTarget;
        uint256 tokenReserveAmount;
        address[] rewardBeneficiaries;
        uint16[] rewardSharesBps;
    }

    struct LaunchParameters {
        string name;
        string symbol;
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        bytes32 creatorSalt;
        UERC20Metadata metadata;
        GrowthParameters growth;
    }

    struct LaunchResult {
        address token;
        address growthVault;
        address rangeSource;
        address upstreamRewardVault;
        address positionRecipient;
        uint256 positionTokenId;
        uint256 tokenLiquidityAmount;
        uint256 lockedTokenDust;
        uint256 tokenReserveAmount;
        uint256 initialBuyNativeAmount;
        uint256 initialBuyTokenAmount;
        bytes32 poolId;
        bytes32 vaultConfigurationHash;
        bytes32 launchHash;
    }

    struct InitialBuyCallbackData {
        PoolKey key;
        address creator;
        uint256 nativeAmount;
    }

    error EmptyName();
    error EmptySymbol();
    error InitialBuyBelowMinimum(uint256 actual, uint256 minimum);
    error InvalidCreatedToken(address token);
    error InvalidDependency(address dependency);
    error InvalidInitialBuyDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidInitialBuyResult(uint256 tokenAmount, uint256 residualNativeBalance);
    error InvalidInitialBuySettlement(uint256 actual, uint256 expected);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidAutomationFactory(address expected, address actual);
    error InvalidPosition(uint256 count, uint256 amount0, int24 tickLower, int24 tickUpper);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidNativeTarget(uint256 nativeTarget);
    error InvalidOracleTickDelta(int24 actual, int24 expected);
    error InvalidReserveAmount(uint256 actual, uint256 tokenSupply);
    error InvalidReserveTransfer(uint256 actual, uint256 expected);
    error InvalidSharedHook(address expectedPoolManager, uint24 lpFeePips, int24 tickSpacing);
    error InvalidSwapFeeQuote(uint16 totalSwapFeeBps, uint256 creatorFee, uint256 launcherFee);
    error InvalidVaultFactory(address expected, address actual);
    error MetadataExtraDataTooLong(uint256 actualBytes, uint256 maximumBytes);
    error MetadataImageTooLong(uint256 actualBytes, uint256 maximumBytes);
    error MetadataWebsiteTooLong(uint256 actualBytes, uint256 maximumBytes);
    error PoolRegistrationMismatch(bytes32 actual, bytes32 expected);
    error TokenAddressMismatch(address actual, address predicted);
    error TokenAlreadyExists(address token);
    error TokenCustodyMismatch(
        uint256 launcherBalance,
        uint256 positionManagerBalance,
        uint256 growthVaultBalance,
        uint256 expectedGrowthVaultBalance
    );
    error TokenDescriptionTooLong(uint256 actualBytes, uint256 maximumBytes);
    error TokenNameTooLong(uint256 actualBytes, uint256 maximumBytes);
    error TokenSymbolTooLong(uint256 actualBytes, uint256 maximumBytes);
    error UnauthorizedUnlockCallback(address caller);
    error UnrecognizedFactoryDeployment(address deployment);

    event LiquidityGrowthTokenLaunched(
        address indexed deployer,
        address indexed token,
        bytes32 indexed poolId,
        address feeHook,
        address growthVault,
        address rangeSource,
        address upstreamRewardVault,
        address positionRecipient,
        uint256 positionTokenId,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        bytes32 vaultConfigurationHash,
        bytes32 launchHash
    );
    event LiquidityGrowthConfigured(
        address indexed token,
        uint256 totalSupply,
        uint256 tokenReserveAmount,
        uint256 tokenLiquidityAmount,
        uint256 lockedTokenDust,
        uint256 nativeTarget,
        uint256 maxCompoundNative,
        int24 activeRangeHalfWidthTicks,
        uint64 compoundCooldownSeconds,
        bytes32 launchHash
    );
    event LiquidityGrowthCreatorInitialBuy(
        address indexed deployer,
        address indexed token,
        bytes32 indexed poolId,
        uint256 nativeAmount,
        uint256 tokenAmount,
        bytes32 launchHash
    );

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        UERC20Factory tokenFactory_,
        LiquidityGrowthFeeOracleHookV1 feeHook_,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory_,
        LiquidityGrowthRangeSourceFactoryV1 rangeSourceFactory_,
        LiquidityGrowthVaultFactoryV1 growthVaultFactory_,
        LiquidityGrowthAutomationV1 automation_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_
    ) {
        _requireContract(address(poolManager_));
        _requireContract(address(positionManager_));
        _requireContract(address(tokenFactory_));
        _requireContract(address(feeHook_));
        _requireContract(address(feeSplitVaultFactory_));
        _requireContract(address(rangeSourceFactory_));
        _requireContract(address(growthVaultFactory_));
        _requireContract(address(automation_));
        _requireContract(address(positionForwarderFactory_));

        address positionManagerPoolManager = address(positionManager_.poolManager());
        if (positionManagerPoolManager != address(poolManager_)) {
            revert InvalidPositionManager(address(poolManager_), positionManagerPoolManager);
        }
        address factoryPositionManager = address(positionForwarderFactory_.positionManager());
        if (factoryPositionManager != address(positionManager_)) {
            revert InvalidPositionManagerFactory(address(positionManager_), factoryPositionManager);
        }
        if (
            address(feeHook_.poolManager()) != address(poolManager_) || feeHook_.LP_FEE_PIPS() != LP_FEE_PIPS
                || feeHook_.TICK_SPACING() != TICK_SPACING
        ) {
            revert InvalidSharedHook(address(poolManager_), feeHook_.LP_FEE_PIPS(), feeHook_.TICK_SPACING());
        }
        int24 configuredMaxAbsTickDelta = feeHook_.maxAbsTickDelta();
        if (configuredMaxAbsTickDelta != MAX_ABS_TICK_DELTA) {
            revert InvalidOracleTickDelta(configuredMaxAbsTickDelta, MAX_ABS_TICK_DELTA);
        }
        address configuredVaultFactory = address(feeHook_.feeSplitVaultFactory());
        if (configuredVaultFactory != address(feeSplitVaultFactory_)) {
            revert InvalidVaultFactory(address(feeSplitVaultFactory_), configuredVaultFactory);
        }
        address automationVaultFactory = address(automation_.vaultFactory());
        if (automationVaultFactory != address(growthVaultFactory_)) {
            revert InvalidAutomationFactory(address(growthVaultFactory_), automationVaultFactory);
        }

        poolManager = poolManager_;
        positionManager = positionManager_;
        tokenFactory = tokenFactory_;
        feeHook = feeHook_;
        feeSplitVaultFactory = feeSplitVaultFactory_;
        rangeSourceFactory = rangeSourceFactory_;
        growthVaultFactory = growthVaultFactory_;
        automation = automation_;
        positionForwarderFactory = positionForwarderFactory_;
    }

    /// @notice Atomically creates the token, funds its growth reserve and opens its locked v4 market.
    /// @dev This prototype must remain excluded from production release manifests until all documented gates pass.
    function launch(LaunchParameters calldata parameters)
        external
        payable
        nonReentrant
        returns (LaunchResult memory result)
    {
        _validateLaunch(parameters);
        if (msg.value < MIN_INITIAL_BUY_WEI) {
            revert InitialBuyBelowMinimum(msg.value, MIN_INITIAL_BUY_WEI);
        }
        result.initialBuyNativeAmount = msg.value;
        result.tokenReserveAmount = parameters.growth.tokenReserveAmount;

        bytes32 effectiveGraffiti = _effectiveGraffiti(msg.sender, parameters.creatorSalt);
        result.token = tokenFactory.getUERC20Address(
            parameters.name, parameters.symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti
        );
        if (result.token.code.length != 0) revert TokenAlreadyExists(result.token);

        PoolKey memory key = _poolKey(result.token);
        result.poolId = PoolId.unwrap(key.toId());
        result.rangeSource = _deployOrReuseRangeSource(result.token, msg.sender, key);
        LiquidityGrowthVaultV1.Configuration memory configuration =
            _growthConfiguration(key, parameters.growth, LiquidityGrowthRangeSourceV1(result.rangeSource));
        result.growthVault = _deployOrReuseGrowthVault(result.token, msg.sender, configuration);
        result.upstreamRewardVault = address(LiquidityGrowthVaultV1(payable(result.growthVault)).upstreamVault());
        result.vaultConfigurationHash = LiquidityGrowthVaultV1(payable(result.growthVault)).configurationHash();
        result.positionRecipient = _deployOrReusePositionRecipient(result.token, msg.sender);

        _createAndVerifyToken(parameters, effectiveGraffiti, result.token);
        _fundReserve(result.token, result.growthVault, result.tokenReserveAmount);

        bytes32 registeredPoolId = feeHook.registerPool(
            key, result.upstreamRewardVault, parameters.buySwapFeeBps, parameters.sellSwapFeeBps
        );
        if (registeredPoolId != result.poolId) {
            revert PoolRegistrationMismatch(registeredPoolId, result.poolId);
        }

        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        int24 initializedTick = poolManager.initialize(key, initialSqrtPriceX96);
        if (initializedTick != INITIAL_TICK) revert InvalidInitialTick(initializedTick, INITIAL_TICK);
        // Registration and the minimal 1 -> 2 oracle stage are part of launch. Later permissionless stages grow
        // capacity in bounded increments without charging the creator for all observation slots here.
        automation.registerAndStageOracle(result.growthVault);

        uint256 poolTokenBudget = TOKEN_SUPPLY - result.tokenReserveAmount;
        (Plan memory plan, Position memory position, uint256 lockedTokenDust) =
            _buildOneSidedPlan(key, result.positionRecipient, initialSqrtPriceX96, poolTokenBudget);
        result.positionTokenId = positionManager.nextTokenId();
        result.tokenLiquidityAmount = position.amount1;
        result.lockedTokenDust = lockedTokenDust;

        IERC20(result.token).safeTransfer(address(positionManager), poolTokenBudget);
        positionManager.modifyLiquidities(abi.encode(plan.actions, plan.params), block.timestamp);
        _verifyTokenCustody(result);

        result.initialBuyTokenAmount = _executeInitialBuy(key, msg.sender, result.initialBuyNativeAmount);
        // ReentrancyGuardTransient protects the complete launch; Slither does not model its transient lock.
        // slither-disable-next-line reentrancy-benign
        result.launchHash = _recordLaunch(parameters, result, position, effectiveGraffiti, msg.sender);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);

        InitialBuyCallbackData memory callback = abi.decode(data, (InitialBuyCallbackData));
        BalanceDelta delta = poolManager.swap(
            callback.key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -callback.nativeAmount.toInt256(),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        int128 nativeDelta = delta.amount0();
        int128 tokenDelta = delta.amount1();
        if (nativeDelta >= 0 || tokenDelta <= 0) revert InvalidInitialBuyDelta(nativeDelta, tokenDelta);

        uint256 nativeSettlement = (-int256(nativeDelta)).toUint256();
        if (nativeSettlement != callback.nativeAmount) {
            revert InvalidInitialBuySettlement(nativeSettlement, callback.nativeAmount);
        }
        uint256 tokenAmount = int256(tokenDelta).toUint256();

        NATIVE.settle(poolManager, address(this), nativeSettlement, false);
        callback.key.currency1.take(poolManager, callback.creator, tokenAmount, false);
        return abi.encode(tokenAmount);
    }

    function _deployOrReuseGrowthVault(
        address token,
        address deployer,
        LiquidityGrowthVaultV1.Configuration memory configuration
    ) private returns (address growthVault) {
        bytes32 salt = _growthVaultSalt(token, deployer);
        growthVault = address(growthVaultFactory.deployOrGet(salt, feeHook, feeSplitVaultFactory, configuration));
    }

    function _deployOrReuseRangeSource(address token, address deployer, PoolKey memory key)
        private
        returns (address sourceAddress)
    {
        bytes32 salt = _rangeSourceSalt(token, deployer);
        sourceAddress = address(
            rangeSourceFactory.deployOrGet(
                salt,
                poolManager,
                key,
                ILiquidityGrowthOracleV1(address(feeHook)),
                TWAP_WINDOW,
                ACTIVE_RANGE_HALF_WIDTH_TICKS,
                MAX_SPOT_TWAP_DEVIATION_TICKS
            )
        );
    }

    function _deployOrReusePositionRecipient(address token, address deployer) private returns (address recipient) {
        bytes32 salt = _positionSalt(token, deployer);
        recipient = positionForwarderFactory.predict(salt, deployer);
        if (recipient.code.length == 0) {
            return address(positionForwarderFactory.deploy(salt, deployer));
        }

        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(recipient));
        if (
            positionForwarderFactory.configurationHashOf(recipient) == bytes32(0)
                || address(forwarder.positionManager()) != address(positionManager)
                || forwarder.operator() != address(0) || forwarder.timelockBlockNumber() != type(uint256).max
                || forwarder.feeRecipient() != deployer
        ) {
            revert UnrecognizedFactoryDeployment(recipient);
        }
    }

    function _createAndVerifyToken(
        LaunchParameters calldata parameters,
        bytes32 effectiveGraffiti,
        address predictedToken
    ) private {
        address createdToken = tokenFactory.createToken(
            parameters.name,
            parameters.symbol,
            TOKEN_DECIMALS,
            TOKEN_SUPPLY,
            address(this),
            abi.encode(parameters.metadata),
            effectiveGraffiti
        );
        if (createdToken != predictedToken) revert TokenAddressMismatch(createdToken, predictedToken);

        UERC20 token = UERC20(createdToken);
        if (
            token.creator() != address(this) || token.graffiti() != effectiveGraffiti
                || token.decimals() != TOKEN_DECIMALS || token.totalSupply() != TOKEN_SUPPLY
                || token.balanceOf(address(this)) != TOKEN_SUPPLY
        ) {
            revert InvalidCreatedToken(createdToken);
        }
    }

    function _fundReserve(address token, address growthVault, uint256 reserveAmount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(growthVault);
        IERC20(token).safeTransfer(growthVault, reserveAmount);
        uint256 received = IERC20(token).balanceOf(growthVault) - beforeBalance;
        if (beforeBalance != 0 || received != reserveAmount) {
            revert InvalidReserveTransfer(received, reserveAmount);
        }
    }

    function _buildOneSidedPlan(
        PoolKey memory key,
        address positionRecipient,
        uint160 initialSqrtPriceX96,
        uint256 tokenBudget
    ) private pure returns (Plan memory plan, Position memory position, uint256 lockedTokenDust) {
        int24 minUsableTick = TickMath.minUsableTick(TICK_SPACING);
        PositionDefinition[] memory definitions = new PositionDefinition[](1);
        definitions[0] = PositionDefinition({
            offsetLower: minUsableTick - INITIAL_TICK,
            offsetUpper: 0,
            weight: POSITION_WEIGHT,
            overridePositionRecipient: positionRecipient
        });

        CurrencyAmounts memory available = CurrencyAmounts({ amount0: 0, amount1: tokenBudget });
        (Position[] memory positions, CurrencyAmounts memory remaining) =
            PositionPlanner.resolve(definitions, initialSqrtPriceX96, TICK_SPACING, available, positionRecipient);
        if (
            positions.length != 1 || positions[0].amount0 != 0 || positions[0].tickLower != minUsableTick
                || positions[0].tickUpper != INITIAL_TICK || positions[0].amount1 + remaining.amount1 != tokenBudget
        ) {
            uint256 amount0 = positions.length == 0 ? 0 : positions[0].amount0;
            int24 tickLower = positions.length == 0 ? int24(0) : positions[0].tickLower;
            int24 tickUpper = positions.length == 0 ? int24(0) : positions[0].tickUpper;
            revert InvalidPosition(positions.length, amount0, tickLower, tickUpper);
        }

        position = positions[0];
        lockedTokenDust = remaining.amount1;
        plan = PositionPlanner.toPlan(positions, key, positionRecipient);
    }

    function _executeInitialBuy(PoolKey memory key, address deployer, uint256 nativeAmount)
        private
        returns (uint256 tokenAmount)
    {
        uint256 residualNativeBalance = address(this).balance - nativeAmount;
        bytes memory result = poolManager.unlock(
            abi.encode(InitialBuyCallbackData({ key: key, creator: deployer, nativeAmount: nativeAmount }))
        );
        tokenAmount = abi.decode(result, (uint256));
        if (tokenAmount == 0 || address(this).balance != residualNativeBalance) {
            revert InvalidInitialBuyResult(tokenAmount, address(this).balance);
        }
    }

    function _verifyTokenCustody(LaunchResult memory result) private view {
        uint256 launcherBalance = IERC20(result.token).balanceOf(address(this));
        uint256 positionManagerBalance = IERC20(result.token).balanceOf(address(positionManager));
        uint256 growthVaultBalance = IERC20(result.token).balanceOf(result.growthVault);
        if (launcherBalance != 0 || positionManagerBalance != 0 || growthVaultBalance != result.tokenReserveAmount) {
            revert TokenCustodyMismatch(
                launcherBalance, positionManagerBalance, growthVaultBalance, result.tokenReserveAmount
            );
        }
    }

    function _recordLaunch(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        Position memory position,
        bytes32 effectiveGraffiti,
        address deployer
    ) private returns (bytes32 launchHash) {
        bytes32 parametersHash = keccak256(abi.encode(parameters, effectiveGraffiti));
        bytes32 resultHash = keccak256(abi.encode(result, position.tickLower, position.tickUpper));
        launchHash = keccak256(abi.encode(block.chainid, address(this), deployer, parametersHash, resultHash));
        launchHashOf[result.token] = launchHash;
        growthVaultOf[result.token] = result.growthVault;

        _emitLaunchEvents(parameters, result, deployer, launchHash);
    }

    function _emitLaunchEvents(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        address deployer,
        bytes32 launchHash
    ) private {
        _emitTokenLaunched(parameters, result, deployer, launchHash);
        _emitGrowthConfigured(parameters.growth, result, launchHash);
        emit LiquidityGrowthCreatorInitialBuy(
            deployer,
            result.token,
            result.poolId,
            result.initialBuyNativeAmount,
            result.initialBuyTokenAmount,
            launchHash
        );
    }

    function _emitTokenLaunched(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        address deployer,
        bytes32 launchHash
    ) private {
        emit LiquidityGrowthTokenLaunched(
            deployer,
            result.token,
            result.poolId,
            address(feeHook),
            result.growthVault,
            result.rangeSource,
            result.upstreamRewardVault,
            result.positionRecipient,
            result.positionTokenId,
            parameters.buySwapFeeBps,
            parameters.sellSwapFeeBps,
            result.vaultConfigurationHash,
            launchHash
        );
    }

    function _emitGrowthConfigured(GrowthParameters calldata growth, LaunchResult memory result, bytes32 launchHash)
        private
    {
        emit LiquidityGrowthConfigured(
            result.token,
            TOKEN_SUPPLY,
            result.tokenReserveAmount,
            result.tokenLiquidityAmount,
            result.lockedTokenDust,
            growth.nativeTarget,
            maxCompoundNativeFor(growth.nativeTarget),
            ACTIVE_RANGE_HALF_WIDTH_TICKS,
            COMPOUND_COOLDOWN_SECONDS,
            launchHash
        );
    }

    function _growthConfiguration(
        PoolKey memory key,
        GrowthParameters calldata growth,
        LiquidityGrowthRangeSourceV1 source
    ) private pure returns (LiquidityGrowthVaultV1.Configuration memory configuration) {
        configuration = LiquidityGrowthVaultV1.Configuration({
            poolKey: key,
            rangeSource: source,
            growthTargetNative: growth.nativeTarget,
            maxCompoundNative: maxCompoundNativeFor(growth.nativeTarget),
            tokenReserveTarget: growth.tokenReserveAmount,
            activeRangeHalfWidthTicks: ACTIVE_RANGE_HALF_WIDTH_TICKS,
            compoundCooldownSeconds: COMPOUND_COOLDOWN_SECONDS,
            beneficiaries: growth.rewardBeneficiaries,
            sharesBps: growth.rewardSharesBps
        });
    }

    /// @notice Returns the immutable per-compound native limit for a proposed economic target.
    /// @dev The result is at most 2.5% of the target and never more than 0.25 ETH. It is therefore also bounded by
    ///      the release safety ceiling of min(5% of the target, 0.5 ETH).
    function maxCompoundNativeFor(uint256 nativeTarget) public pure returns (uint256 amount) {
        if (nativeTarget < COMPOUND_TARGET_DIVISOR) revert InvalidNativeTarget(nativeTarget);
        amount = nativeTarget / COMPOUND_TARGET_DIVISOR;
        if (amount > COMPOUND_NATIVE_CAP) amount = COMPOUND_NATIVE_CAP;
    }

    function _poolKey(address token) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: feeHook
        });
    }

    function _validateLaunch(LaunchParameters calldata parameters) private view {
        _validateMetadata(parameters);
        uint256 reserveAmount = parameters.growth.tokenReserveAmount;
        if (reserveAmount == 0 || reserveAmount >= TOKEN_SUPPLY) {
            revert InvalidReserveAmount(reserveAmount, TOKEN_SUPPLY);
        }
        maxCompoundNativeFor(parameters.growth.nativeTarget);

        _validateSwapFee(parameters.buySwapFeeBps);
        _validateSwapFee(parameters.sellSwapFeeBps);
    }

    function _validateSwapFee(uint16 totalSwapFeeBps) private view {
        // Reuse the hook's single source of truth for directional bounds, increments and the fixed protocol split.
        (uint256 creatorFee, uint256 launcherFee) = feeHook.quoteGrossFees(1 ether, totalSwapFeeBps);
        if (creatorFee == 0 || launcherFee == 0) {
            revert InvalidSwapFeeQuote(totalSwapFeeBps, creatorFee, launcherFee);
        }
    }

    function _validateMetadata(LaunchParameters calldata parameters) private pure {
        uint256 nameBytes = bytes(parameters.name).length;
        uint256 symbolBytes = bytes(parameters.symbol).length;
        uint256 descriptionBytes = bytes(parameters.metadata.description).length;
        uint256 websiteBytes = bytes(parameters.metadata.website).length;
        uint256 imageBytes = bytes(parameters.metadata.image).length;
        uint256 extraDataBytes = parameters.metadata.extraData.length;

        if (nameBytes == 0) revert EmptyName();
        if (symbolBytes == 0) revert EmptySymbol();
        if (nameBytes > MAX_TOKEN_NAME_BYTES) revert TokenNameTooLong(nameBytes, MAX_TOKEN_NAME_BYTES);
        if (symbolBytes > MAX_TOKEN_SYMBOL_BYTES) {
            revert TokenSymbolTooLong(symbolBytes, MAX_TOKEN_SYMBOL_BYTES);
        }
        if (descriptionBytes > MAX_TOKEN_DESCRIPTION_BYTES) {
            revert TokenDescriptionTooLong(descriptionBytes, MAX_TOKEN_DESCRIPTION_BYTES);
        }
        if (websiteBytes > MAX_METADATA_URL_BYTES) {
            revert MetadataWebsiteTooLong(websiteBytes, MAX_METADATA_URL_BYTES);
        }
        if (imageBytes > MAX_METADATA_URL_BYTES) {
            revert MetadataImageTooLong(imageBytes, MAX_METADATA_URL_BYTES);
        }
        if (extraDataBytes > MAX_SOCIAL_EXTRA_DATA_BYTES) {
            revert MetadataExtraDataTooLong(extraDataBytes, MAX_SOCIAL_EXTRA_DATA_BYTES);
        }
    }

    function _effectiveGraffiti(address deployer, bytes32 creatorSalt) private pure returns (bytes32) {
        return keccak256(abi.encode(deployer, creatorSalt));
    }

    function _positionSalt(address token, address deployer) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.liquidity-growth.launch-position.v1", token, deployer));
    }

    function _growthVaultSalt(address token, address deployer) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.liquidity-growth.vault.v1", token, deployer));
    }

    function _rangeSourceSalt(address token, address deployer) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.liquidity-growth.range-source.v1", token, deployer));
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
