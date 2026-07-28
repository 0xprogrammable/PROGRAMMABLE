// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { Plan, Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
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
import { LiquidityGrowthFullRangeAutomationV1 } from "./LiquidityGrowthFullRangeAutomationV1.sol";
import { LiquidityGrowthFullRangePolicyV1 as Policy } from "./LiquidityGrowthFullRangePolicyV1.sol";
import { LiquidityGrowthFullRangePositionPlannerV1 } from "./LiquidityGrowthFullRangePositionPlannerV1.sol";
import { LiquidityGrowthFullRangeVaultFactoryV1 } from "./LiquidityGrowthFullRangeVaultFactoryV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "./LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthRangeSourceFactoryV1 } from "./LiquidityGrowthRangeSourceFactoryV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "./LiquidityGrowthRangeSourceV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "./interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";
import { ILiquidityGrowthOracleV1 } from "./interfaces/ILiquidityGrowthOracleV1.sol";

/// @title LiquidityGrowthFullRangeLaunchV1
/// @notice Launches the fixed 0.05 ETH / 150M reserve full-range liquidity-growth model atomically.
/// @dev Uses the staged composite fee-oracle hook. Full-range compounds remain disabled until capacity reaches 192,
///      a real 30-minute history exists, spot is within 600 ticks of TWAP and all vault economic gates pass.
///      The payable launch spends exactly its own `msg.value`; `_executeInitialBuy` proves the residual balance is
///      unchanged, so forced ETH is preserved but no launch payment can become contract custody.
// slither-disable-next-line locked-ether
contract LiquidityGrowthFullRangeLaunchV1 is IUnlockCallback, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for *;
    using SafeERC20 for IERC20;

    uint8 public constant TOKEN_DECIMALS = 18;
    uint256 public constant TOKEN_SUPPLY = Policy.TOKEN_SUPPLY;
    uint256 public constant TOKEN_RESERVE_TARGET = Policy.TOKEN_RESERVE_TARGET;
    uint256 public constant GROWTH_TARGET_NATIVE = Policy.GROWTH_TARGET_NATIVE;
    uint256 public constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    uint256 public constant MAX_TOKEN_NAME_BYTES = 48;
    uint256 public constant MAX_TOKEN_SYMBOL_BYTES = 12;
    uint256 public constant MAX_TOKEN_DESCRIPTION_BYTES = 280;
    uint256 public constant MAX_METADATA_URL_BYTES = 2048;
    uint256 public constant MAX_SOCIAL_EXTRA_DATA_BYTES = 1200;
    int24 public constant INITIAL_TICK = Policy.INITIAL_TICK;
    int24 public constant TICK_SPACING = Policy.TICK_SPACING;
    uint24 public constant LP_FEE_PIPS = 0;
    uint32 public constant TWAP_WINDOW = 30 minutes;
    int24 public constant ORACLE_RANGE_HALF_WIDTH_TICKS = 20_000;
    int24 public constant MAX_SPOT_TWAP_DEVIATION_TICKS = 600;
    int24 public constant MAX_ABS_TICK_DELTA = 400;
    // Used inside unlockCallback; Slither 0.11.5 loses that edge when v4's packed delta IR generation fails.
    // slither-disable-next-line unused-state
    Currency private constant NATIVE = Currency.wrap(address(0));

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    UERC20Factory public immutable tokenFactory;
    ILiquidityGrowthFullRangeOracleHookV1 public immutable feeHook;
    FeeSplitVaultFactoryV1 public immutable feeSplitVaultFactory;
    LiquidityGrowthRangeSourceFactoryV1 public immutable rangeSourceFactory;
    LiquidityGrowthFullRangeVaultFactoryV1 public immutable growthVaultFactory;
    LiquidityGrowthFullRangeAutomationV1 public immutable automation;
    LiquidityGrowthFullRangePositionPlannerV1 public immutable positionPlanner;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;

    mapping(address token => bytes32 launchHash) public launchHashOf;
    mapping(address token => address growthVault) public growthVaultOf;

    struct LaunchParameters {
        string name;
        string symbol;
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        bytes32 creatorSalt;
        UERC20Metadata metadata;
        address[] rewardBeneficiaries;
        uint16[] rewardSharesBps;
    }

    struct LaunchResult {
        address token;
        address growthVault;
        address oracleGuard;
        address upstreamRewardVault;
        address positionRecipient;
        uint256 positionTokenId;
        uint256 tokenLiquidityAmount;
        uint256 lockedTokenDust;
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
    error InvalidAutomationFactory(address expected, address actual);
    error InvalidCreatedToken(address token);
    error InvalidDependency(address dependency);
    error InvalidInitialBuyDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidInitialBuyResult(uint256 tokenAmount, uint256 residualNativeBalance);
    error InvalidInitialBuySettlement(uint256 actual, uint256 expected);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidPosition(uint256 count, uint256 amount0, int24 tickLower, int24 tickUpper);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidReserveTransfer(uint256 actual, uint256 expected);
    error InvalidSharedHook(address hook);
    error InvalidSwapFeeQuote(uint16 totalSwapFeeBps, uint256 creatorFee, uint256 launcherFee);
    error InvalidVaultFactory(address expected, address actual);
    error MetadataExtraDataTooLong(uint256 actualBytes, uint256 maximumBytes);
    error MetadataImageTooLong(uint256 actualBytes, uint256 maximumBytes);
    error MetadataWebsiteTooLong(uint256 actualBytes, uint256 maximumBytes);
    error PoolRegistrationMismatch(bytes32 actual, bytes32 expected);
    error PositionTokenIdMismatch(uint256 actual, uint256 expected);
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

    event LiquidityGrowthFullRangeTokenLaunched(
        address indexed deployer,
        address indexed token,
        bytes32 indexed poolId,
        address feeHook,
        address growthVault,
        address oracleGuard,
        address upstreamRewardVault,
        address positionRecipient,
        uint256 positionTokenId,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        bytes32 vaultConfigurationHash,
        bytes32 launchHash
    );
    event LiquidityGrowthFullRangeConfigured(
        address indexed token,
        uint256 totalSupply,
        uint256 tokenReserve,
        uint256 tokenLiquidityAmount,
        uint256 lockedTokenDust,
        uint256 nativeTarget,
        int24 tickLower,
        int24 tickUpper,
        uint32 twapWindow,
        int24 maxSpotTwapDeviationTicks,
        bytes32 launchHash
    );
    event LiquidityGrowthFullRangeCreatorInitialBuy(
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
        ILiquidityGrowthFullRangeOracleHookV1 feeHook_,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory_,
        LiquidityGrowthRangeSourceFactoryV1 rangeSourceFactory_,
        LiquidityGrowthFullRangeVaultFactoryV1 growthVaultFactory_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_
    ) {
        _requireContract(address(poolManager_));
        _requireContract(address(positionManager_));
        _requireContract(address(tokenFactory_));
        _requireContract(address(feeHook_));
        _requireContract(address(feeSplitVaultFactory_));
        _requireContract(address(rangeSourceFactory_));
        _requireContract(address(growthVaultFactory_));
        _requireContract(address(positionForwarderFactory_));

        if (address(positionManager_.poolManager()) != address(poolManager_)) {
            revert InvalidPositionManager(address(poolManager_), address(positionManager_.poolManager()));
        }
        if (address(positionForwarderFactory_.positionManager()) != address(positionManager_)) {
            revert InvalidPositionManagerFactory(
                address(positionManager_), address(positionForwarderFactory_.positionManager())
            );
        }
        if (
            address(feeHook_.poolManager()) != address(poolManager_) || feeHook_.LP_FEE_PIPS() != LP_FEE_PIPS
                || feeHook_.TICK_SPACING() != TICK_SPACING || feeHook_.maxAbsTickDelta() != MAX_ABS_TICK_DELTA
        ) revert InvalidSharedHook(address(feeHook_));
        if (address(feeHook_.feeSplitVaultFactory()) != address(feeSplitVaultFactory_)) {
            revert InvalidVaultFactory(address(feeSplitVaultFactory_), address(feeHook_.feeSplitVaultFactory()));
        }
        if (
            address(growthVaultFactory_.poolManager()) != address(poolManager_)
                || address(growthVaultFactory_.positionManager()) != address(positionManager_)
                || address(growthVaultFactory_.feeSplitVaultFactory()) != address(feeSplitVaultFactory_)
                || address(growthVaultFactory_.rangeSourceFactory()) != address(rangeSourceFactory_)
                || address(growthVaultFactory_.positionForwarderFactory()) != address(positionForwarderFactory_)
        ) revert InvalidVaultFactory(address(growthVaultFactory_), address(0));
        Policy.validateFixedPolicy();

        poolManager = poolManager_;
        positionManager = positionManager_;
        tokenFactory = tokenFactory_;
        feeHook = feeHook_;
        feeSplitVaultFactory = feeSplitVaultFactory_;
        rangeSourceFactory = rangeSourceFactory_;
        growthVaultFactory = growthVaultFactory_;
        automation = new LiquidityGrowthFullRangeAutomationV1(growthVaultFactory_, address(this));
        positionPlanner = new LiquidityGrowthFullRangePositionPlannerV1();
        positionForwarderFactory = positionForwarderFactory_;
    }

    function predictTokenAddress(string calldata name, string calldata symbol, address deployer, bytes32 creatorSalt)
        external
        view
        returns (address token, bytes32 effectiveGraffiti)
    {
        effectiveGraffiti = _effectiveGraffiti(deployer, creatorSalt);
        token = tokenFactory.getUERC20Address(name, symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti);
    }

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

        bytes32 graffiti = _effectiveGraffiti(msg.sender, parameters.creatorSalt);
        result.token =
            tokenFactory.getUERC20Address(parameters.name, parameters.symbol, TOKEN_DECIMALS, address(this), graffiti);
        if (result.token.code.length != 0) revert TokenAlreadyExists(result.token);
        _createAndVerifyToken(parameters, graffiti, result.token);

        PoolKey memory key = _poolKey(result.token);
        result.poolId = PoolId.unwrap(key.toId());
        result.positionRecipient = _deployOrReusePositionRecipient(result.token, msg.sender);
        result.positionTokenId = positionManager.nextTokenId();
        result.oracleGuard = _deployOrReuseOracleGuard(result.token, msg.sender, key);
        result.growthVault = _deployOrReuseGrowthVault(parameters, result, key);
        LiquidityGrowthFullRangeVaultV1 vault = LiquidityGrowthFullRangeVaultV1(payable(result.growthVault));
        result.upstreamRewardVault = address(vault.upstreamVault());
        result.vaultConfigurationHash = vault.configurationHash();

        _fundReserve(result.token, result.growthVault);
        bytes32 registeredPoolId =
            feeHook.registerPool(key, result.upstreamRewardVault, parameters.buySwapFeeBps, parameters.sellSwapFeeBps);
        if (registeredPoolId != result.poolId) {
            revert PoolRegistrationMismatch(registeredPoolId, result.poolId);
        }

        uint160 initialSqrtPriceX96 = Policy.initialSqrtPriceX96();
        int24 initializedTick = poolManager.initialize(key, initialSqrtPriceX96);
        if (initializedTick != INITIAL_TICK) revert InvalidInitialTick(initializedTick, INITIAL_TICK);
        automation.registerAndStageOracle(result.growthVault);

        (Plan memory plan, Position memory position, uint256 dust) =
            positionPlanner.buildOneSidedPlan(key, result.positionRecipient);
        result.tokenLiquidityAmount = position.amount1;
        result.lockedTokenDust = dust;
        IERC20(result.token).safeTransfer(address(positionManager), TOKEN_SUPPLY - TOKEN_RESERVE_TARGET);
        uint256 actualTokenId = positionManager.nextTokenId();
        if (actualTokenId != result.positionTokenId) {
            revert PositionTokenIdMismatch(actualTokenId, result.positionTokenId);
        }
        positionManager.modifyLiquidities(abi.encode(plan.actions, plan.params), block.timestamp);
        _verifyCustodyAndPosition(result, position);

        result.initialBuyTokenAmount = _executeInitialBuy(key, msg.sender, msg.value);
        // ReentrancyGuardTransient protects the complete launch; Slither does not model its transient lock.
        // slither-disable-next-line reentrancy-benign
        result.launchHash = _recordLaunch(parameters, result, position, graffiti, msg.sender);
    }

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

    function _deployOrReuseOracleGuard(address token, address deployer, PoolKey memory key)
        private
        returns (address guard)
    {
        bytes32 salt = keccak256(abi.encode("programmable.full-range.oracle-guard.v1", token, deployer));
        guard = address(
            rangeSourceFactory.deployOrGet(
                salt,
                poolManager,
                key,
                ILiquidityGrowthOracleV1(address(feeHook)),
                TWAP_WINDOW,
                ORACLE_RANGE_HALF_WIDTH_TICKS,
                MAX_SPOT_TWAP_DEVIATION_TICKS
            )
        );
    }

    function _deployOrReuseGrowthVault(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        PoolKey memory key
    ) private returns (address vaultAddress) {
        LiquidityGrowthFullRangeVaultV1.Configuration memory configuration =
            LiquidityGrowthFullRangeVaultV1.Configuration({
                poolKey: key,
                oracleGuard: LiquidityGrowthRangeSourceV1(result.oracleGuard),
                positionManager: positionManager,
                positionForwarderFactory: positionForwarderFactory,
                initialPositionTokenId: result.positionTokenId,
                initialPositionRecipient: result.positionRecipient,
                beneficiaries: parameters.rewardBeneficiaries,
                sharesBps: parameters.rewardSharesBps
            });
        bytes32 salt = keccak256(abi.encode("programmable.full-range.vault.v1", result.token, msg.sender));
        vaultAddress = address(growthVaultFactory.deployOrGet(salt, feeHook, configuration));
    }

    function _deployOrReusePositionRecipient(address token, address deployer) private returns (address recipient) {
        bytes32 salt = keccak256(abi.encode("programmable.full-range.launch-position.v1", token, deployer));
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
        ) revert UnrecognizedFactoryDeployment(recipient);
    }

    function _createAndVerifyToken(LaunchParameters calldata parameters, bytes32 graffiti, address predictedToken)
        private
    {
        address created = tokenFactory.createToken(
            parameters.name,
            parameters.symbol,
            TOKEN_DECIMALS,
            TOKEN_SUPPLY,
            address(this),
            abi.encode(parameters.metadata),
            graffiti
        );
        if (created != predictedToken) revert TokenAddressMismatch(created, predictedToken);
        UERC20 token = UERC20(created);
        if (
            token.creator() != address(this) || token.graffiti() != graffiti || token.decimals() != TOKEN_DECIMALS
                || token.totalSupply() != TOKEN_SUPPLY || token.balanceOf(address(this)) != TOKEN_SUPPLY
        ) revert InvalidCreatedToken(created);
    }

    function _fundReserve(address token, address vault) private {
        uint256 beforeBalance = IERC20(token).balanceOf(vault);
        IERC20(token).safeTransfer(vault, TOKEN_RESERVE_TARGET);
        uint256 received = IERC20(token).balanceOf(vault) - beforeBalance;
        if (beforeBalance != 0 || received != TOKEN_RESERVE_TARGET) {
            revert InvalidReserveTransfer(received, TOKEN_RESERVE_TARGET);
        }
    }

    function _executeInitialBuy(PoolKey memory key, address creator, uint256 nativeAmount)
        private
        returns (uint256 tokenAmount)
    {
        uint256 residualNativeBalance = address(this).balance - nativeAmount;
        bytes memory returned = poolManager.unlock(
            abi.encode(InitialBuyCallbackData({ key: key, creator: creator, nativeAmount: nativeAmount }))
        );
        tokenAmount = abi.decode(returned, (uint256));
        if (tokenAmount == 0 || address(this).balance != residualNativeBalance) {
            revert InvalidInitialBuyResult(tokenAmount, address(this).balance);
        }
    }

    function _verifyCustodyAndPosition(LaunchResult memory result, Position memory position) private view {
        uint256 launcherBalance = IERC20(result.token).balanceOf(address(this));
        uint256 managerBalance = IERC20(result.token).balanceOf(address(positionManager));
        uint256 vaultBalance = IERC20(result.token).balanceOf(result.growthVault);
        if (launcherBalance != 0 || managerBalance != 0 || vaultBalance != TOKEN_RESERVE_TARGET) {
            revert TokenCustodyMismatch(launcherBalance, managerBalance, vaultBalance, TOKEN_RESERVE_TARGET);
        }
        if (
            IERC721(address(positionManager)).ownerOf(result.positionTokenId) != result.positionRecipient
                || positionManager.getPositionLiquidity(result.positionTokenId) != uint128(position.liquidity)
        ) revert InvalidPosition(1, position.amount0, position.tickLower, position.tickUpper);
    }

    function _recordLaunch(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        Position memory position,
        bytes32 graffiti,
        address deployer
    ) private returns (bytes32 launchHash) {
        bytes32 parametersHash = keccak256(abi.encode(parameters, graffiti));
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
        emit LiquidityGrowthFullRangeTokenLaunched(
            deployer,
            result.token,
            result.poolId,
            address(feeHook),
            result.growthVault,
            result.oracleGuard,
            result.upstreamRewardVault,
            result.positionRecipient,
            result.positionTokenId,
            parameters.buySwapFeeBps,
            parameters.sellSwapFeeBps,
            result.vaultConfigurationHash,
            launchHash
        );
        emit LiquidityGrowthFullRangeConfigured(
            result.token,
            TOKEN_SUPPLY,
            TOKEN_RESERVE_TARGET,
            result.tokenLiquidityAmount,
            result.lockedTokenDust,
            GROWTH_TARGET_NATIVE,
            Policy.FULL_RANGE_TICK_LOWER,
            Policy.FULL_RANGE_TICK_UPPER,
            TWAP_WINDOW,
            MAX_SPOT_TWAP_DEVIATION_TICKS,
            launchHash
        );
        emit LiquidityGrowthFullRangeCreatorInitialBuy(
            deployer,
            result.token,
            result.poolId,
            result.initialBuyNativeAmount,
            result.initialBuyTokenAmount,
            launchHash
        );
    }

    function _poolKey(address token) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(feeHook))
        });
    }

    function _validateLaunch(LaunchParameters calldata parameters) private view {
        _validateMetadata(parameters);
        _validateSwapFee(parameters.buySwapFeeBps);
        _validateSwapFee(parameters.sellSwapFeeBps);
    }

    function _validateSwapFee(uint16 totalSwapFeeBps) private view {
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

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
