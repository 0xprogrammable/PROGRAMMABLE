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
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { LiquidityGrowthFeeOracleHookV2 } from "./LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangeAutomationV3 } from "./LiquidityGrowthFullRangeAutomationV3.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "./LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangePositionPlannerV3 } from "./LiquidityGrowthFullRangePositionPlannerV3.sol";
import { LiquidityGrowthFullRangeVaultFactoryV3 } from "./LiquidityGrowthFullRangeVaultFactoryV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "./LiquidityGrowthFullRangeVaultV3.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";
import { ILiquidityGrowthFeeOracleHookV2 } from "./interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

/// @title LiquidityGrowthFullRangeLaunchV3
/// @notice Creates one Deep token, pool, permanent initial position, protected buy and automation binding atomically.
// slither-disable-next-line locked-ether
contract LiquidityGrowthFullRangeLaunchV3 is IUnlockCallback, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for *;
    using SafeERC20 for IERC20;

    uint8 public constant TOKEN_DECIMALS = 18;
    uint256 public constant TOKEN_SUPPLY = Policy.TOKEN_SUPPLY;
    uint256 public constant MIN_INITIAL_BUY_WEI = Policy.MIN_INITIAL_BUY_WEI;
    uint16 public constant TOTAL_HOOK_FEE_BPS = Policy.TOTAL_HOOK_FEE_BPS;
    uint16 public constant GROWTH_FEE_BPS = Policy.GROWTH_FEE_BPS;
    uint16 public constant PROGRAMMABLE_FEE_BPS = Policy.PROGRAMMABLE_FEE_BPS;
    uint24 public constant LP_FEE_PIPS = Policy.LP_FEE_PIPS;
    int24 public constant TICK_SPACING = Policy.TICK_SPACING;
    int24 public constant INITIAL_TICK = Policy.INITIAL_TICK;
    uint160 public immutable MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96;

    Currency private constant NATIVE = Currency.wrap(address(0));

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    UERC20Factory public immutable tokenFactory;
    LiquidityGrowthFeeOracleHookV2 public immutable feeHook;
    LiquidityGrowthFullRangeVaultFactoryV3 public immutable growthVaultFactory;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;
    LiquidityGrowthFullRangePositionPlannerV3 public immutable positionPlanner;
    LiquidityGrowthFullRangeAutomationV3 public immutable automation;

    mapping(address token => bytes32 launchHash) public launchHashOf;
    mapping(address token => address growthVault) public growthVaultOf;

    struct LaunchParameters {
        string name;
        string symbol;
        UERC20Metadata metadata;
        bytes32 creatorSalt;
        uint256 minimumInitialTokenOut;
        uint160 initialBuySqrtPriceLimitX96;
        uint256 deadline;
    }

    struct LaunchResult {
        address token;
        bytes32 poolId;
        address growthVault;
        address positionRecipient;
        uint256 positionTokenId;
        address oracleGuard;
        uint256 initialBuyNativeAmount;
        uint256 initialBuyTokenAmount;
        uint256 initialLockedTokenDust;
        bytes32 vaultConfigurationHash;
        bytes32 launchHash;
    }

    struct InitialBuyCallbackData {
        PoolKey key;
        address creator;
        uint256 nativeAmount;
        uint256 minimumTokenOut;
        uint160 sqrtPriceLimitX96;
    }

    error EmptyName();
    error EmptySymbol();
    error InitialBuyBelowMinimum(uint256 actual, uint256 minimum);
    error InitialBuyOutputBelowMinimum(uint256 actual, uint256 minimum);
    error InvalidAutomation(address automation);
    error InvalidCreatedToken(address token);
    error InvalidDependency(address dependency);
    error InvalidHook(address hook);
    error InvalidInitialBuyDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidInitialBuyPriceLimit(uint160 supplied, uint160 minimum, uint160 initialPrice);
    error InvalidInitialBuyResult(uint256 tokenAmount, uint256 residualNativeBalance);
    error InvalidInitialBuySettlement(uint256 actual, uint256 expected);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidMinimumTokenOutput();
    error InvalidPosition(uint256 amount0, int24 tickLower, int24 tickUpper, uint256 liquidity);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidVault(address vault);
    error LaunchDeadlineExpired(uint256 deadline, uint256 currentTimestamp);
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

    event LiquidityGrowthFullRangeTokenLaunchedV3(
        address indexed deployer,
        address indexed token,
        bytes32 indexed poolId,
        address feeHook,
        address growthVault,
        address positionRecipient,
        uint256 positionTokenId,
        bytes32 vaultConfigurationHash,
        bytes32 launchHash
    );
    event LiquidityGrowthFullRangeConfiguredV3(
        address indexed token,
        uint256 totalSupply,
        uint256 initialLockedTokenDust,
        uint16 totalHookFeeBps,
        uint16 growthFeeBps,
        uint16 programmableFeeBps,
        int24 initialTick,
        int24 fullRangeTickLower,
        int24 fullRangeTickUpper,
        bytes32 launchHash
    );
    event LiquidityGrowthFullRangeCreatorInitialBuyV3(
        address indexed deployer,
        address indexed token,
        bytes32 indexed poolId,
        uint256 nativeAmount,
        uint256 tokenAmount,
        uint160 sqrtPriceLimitX96,
        bytes32 launchHash
    );

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        UERC20Factory tokenFactory_,
        LiquidityGrowthFeeOracleHookV2 feeHook_,
        LiquidityGrowthFullRangeVaultFactoryV3 growthVaultFactory_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_
    ) {
        _requireContract(address(poolManager_));
        _requireContract(address(positionManager_));
        _requireContract(address(tokenFactory_));
        _requireContract(address(feeHook_));
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
            address(feeHook_.poolManager()) != address(poolManager_)
                || address(feeHook_.positionManager()) != address(positionManager_)
                || address(feeHook_.growthVaultFactory()) != address(growthVaultFactory_)
                || feeHook_.TOTAL_HOOK_FEE_BPS() != TOTAL_HOOK_FEE_BPS || feeHook_.GROWTH_FEE_BPS() != GROWTH_FEE_BPS
                || feeHook_.PROGRAMMABLE_FEE_BPS() != PROGRAMMABLE_FEE_BPS || feeHook_.LP_FEE_PIPS() != LP_FEE_PIPS
                || feeHook_.TICK_SPACING() != TICK_SPACING
                || feeHook_.maxAbsTickDelta() != Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        ) revert InvalidHook(address(feeHook_));
        Policy.validateFixedPolicy();

        poolManager = poolManager_;
        positionManager = positionManager_;
        tokenFactory = tokenFactory_;
        feeHook = feeHook_;
        growthVaultFactory = growthVaultFactory_;
        positionForwarderFactory = positionForwarderFactory_;
        MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96 =
            TickMath.getSqrtPriceAtTick(Policy.INITIAL_TICK - Policy.MAX_ABS_OBSERVATION_TICK_DELTA);
        positionPlanner = new LiquidityGrowthFullRangePositionPlannerV3();
        automation = new LiquidityGrowthFullRangeAutomationV3(growthVaultFactory_, address(this));
    }

    function predictTokenAddress(string calldata name, string calldata symbol, address deployer, bytes32 creatorSalt)
        external
        view
        returns (address token, bytes32 effectiveGraffiti)
    {
        effectiveGraffiti = _effectiveGraffiti(deployer, creatorSalt);
        token = tokenFactory.getUERC20Address(name, symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti);
    }

    function poolKey(address token) public view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(feeHook))
        });
    }

    function launch(LaunchParameters calldata parameters)
        external
        payable
        nonReentrant
        returns (LaunchResult memory result)
    {
        _validateLaunch(parameters, msg.value);
        result.initialBuyNativeAmount = msg.value;

        bytes32 graffiti = _effectiveGraffiti(msg.sender, parameters.creatorSalt);
        result.token =
            tokenFactory.getUERC20Address(parameters.name, parameters.symbol, TOKEN_DECIMALS, address(this), graffiti);
        if (result.token.code.length != 0) revert TokenAlreadyExists(result.token);
        _createAndVerifyToken(parameters, graffiti, result.token);

        PoolKey memory key = poolKey(result.token);
        result.poolId = PoolId.unwrap(key.toId());
        result.initialLockedTokenDust = positionPlanner.initialTokenDust();
        result.growthVault = _deployGrowthVault(parameters.creatorSalt, msg.sender, key, result.initialLockedTokenDust);
        result.positionRecipient =
            _deployOrReusePositionRecipient(parameters.creatorSalt, result.token, msg.sender, result.growthVault);
        result.positionTokenId = positionManager.nextTokenId();
        result.oracleGuard = address(feeHook);

        bytes32 registeredPoolId = feeHook.registerPool(key, result.growthVault);
        if (registeredPoolId != result.poolId) {
            revert PoolRegistrationMismatch(registeredPoolId, result.poolId);
        }
        int24 initializedTick = poolManager.initialize(key, Policy.initialSqrtPriceX96());
        if (initializedTick != INITIAL_TICK) revert InvalidInitialTick(initializedTick, INITIAL_TICK);

        (Plan memory plan, Position memory position, uint256 dust) = positionPlanner.buildOneSidedPlan(
            key, result.positionRecipient, address(this), feeHook.BOOTSTRAP_DOMAIN_TAG()
        );
        if (dust != result.initialLockedTokenDust) revert InvalidVault(result.growthVault);
        IERC20(result.token).safeTransfer(address(positionManager), TOKEN_SUPPLY);
        if (positionManager.nextTokenId() != result.positionTokenId) {
            revert PositionTokenIdMismatch(positionManager.nextTokenId(), result.positionTokenId);
        }
        positionManager.modifyLiquidities(abi.encode(plan.actions, plan.params), parameters.deadline);

        result.initialBuyTokenAmount = _executeInitialBuy(key, msg.sender, msg.value, parameters);
        IERC20(result.token).safeTransfer(result.growthVault, result.initialLockedTokenDust);
        result.vaultConfigurationHash = _verifyCustodyAndPosition(result, position);

        feeHook.finalizePool(key);
        automation.registerAndStageOracle(result.growthVault);
        result.launchHash = _recordLaunch(parameters, result, graffiti, msg.sender);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);
        InitialBuyCallbackData memory callback = abi.decode(data, (InitialBuyCallbackData));
        BalanceDelta delta = poolManager.swap(
            callback.key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -callback.nativeAmount.toInt256(),
                sqrtPriceLimitX96: callback.sqrtPriceLimitX96
            }),
            abi.encode(feeHook.LAUNCH_BUY_DOMAIN_TAG())
        );
        int128 nativeDelta = delta.amount0();
        int128 tokenDelta = delta.amount1();
        if (nativeDelta >= 0 || tokenDelta <= 0) revert InvalidInitialBuyDelta(nativeDelta, tokenDelta);
        uint256 nativeSettlement = (-int256(nativeDelta)).toUint256();
        if (nativeSettlement != callback.nativeAmount) {
            revert InvalidInitialBuySettlement(nativeSettlement, callback.nativeAmount);
        }
        uint256 tokenAmount = int256(tokenDelta).toUint256();
        if (tokenAmount < callback.minimumTokenOut) {
            revert InitialBuyOutputBelowMinimum(tokenAmount, callback.minimumTokenOut);
        }
        NATIVE.settle(poolManager, address(this), nativeSettlement, false);
        callback.key.currency1.take(poolManager, callback.creator, tokenAmount, false);
        return abi.encode(tokenAmount);
    }

    function _deployGrowthVault(bytes32 creatorSalt, address deployer, PoolKey memory key, uint256 initialTokenDust)
        private
        returns (address vaultAddress)
    {
        bytes32 vaultSalt = keccak256(abi.encode("programmable.deep.vault.v3", deployer, creatorSalt, key));
        vaultAddress = address(
            growthVaultFactory.deploy(
                vaultSalt, ILiquidityGrowthFeeOracleHookV2(address(feeHook)), key, initialTokenDust
            )
        );
    }

    function _deployOrReusePositionRecipient(bytes32 creatorSalt, address token, address deployer, address growthVault)
        private
        returns (address recipient)
    {
        bytes32 salt = keccak256(abi.encode("programmable.deep.initial-position.v3", token, deployer, creatorSalt));
        recipient = positionForwarderFactory.predict(salt, growthVault);
        if (recipient.code.length == 0) {
            return address(positionForwarderFactory.deploy(salt, growthVault));
        }
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(recipient));
        if (
            positionForwarderFactory.configurationHashOf(recipient) == bytes32(0)
                || address(forwarder.positionManager()) != address(positionManager)
                || forwarder.operator() != address(0) || forwarder.timelockBlockNumber() != type(uint256).max
                || forwarder.feeRecipient() != growthVault
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

    function _executeInitialBuy(
        PoolKey memory key,
        address creator,
        uint256 nativeAmount,
        LaunchParameters calldata parameters
    ) private returns (uint256 tokenAmount) {
        uint256 residualNativeBalance = address(this).balance - nativeAmount;
        bytes memory returned = poolManager.unlock(
            abi.encode(
                InitialBuyCallbackData({
                    key: key,
                    creator: creator,
                    nativeAmount: nativeAmount,
                    minimumTokenOut: parameters.minimumInitialTokenOut,
                    sqrtPriceLimitX96: parameters.initialBuySqrtPriceLimitX96
                })
            )
        );
        tokenAmount = abi.decode(returned, (uint256));
        if (tokenAmount == 0 || address(this).balance != residualNativeBalance) {
            revert InvalidInitialBuyResult(tokenAmount, address(this).balance);
        }
    }

    function _verifyCustodyAndPosition(LaunchResult memory result, Position memory position)
        private
        view
        returns (bytes32 configurationHash)
    {
        uint256 launcherBalance = IERC20(result.token).balanceOf(address(this));
        uint256 positionManagerBalance = IERC20(result.token).balanceOf(address(positionManager));
        uint256 growthVaultBalance = IERC20(result.token).balanceOf(result.growthVault);
        if (launcherBalance != 0 || positionManagerBalance != 0 || growthVaultBalance != result.initialLockedTokenDust)
        {
            revert TokenCustodyMismatch(
                launcherBalance, positionManagerBalance, growthVaultBalance, result.initialLockedTokenDust
            );
        }
        if (
            IERC721(address(positionManager)).ownerOf(result.positionTokenId) != result.positionRecipient
                || positionManager.getPositionLiquidity(result.positionTokenId) != uint128(position.liquidity)
                || position.amount0 != 0 || position.tickLower != Policy.FULL_RANGE_TICK_LOWER
                || position.tickUpper != INITIAL_TICK
        ) revert InvalidPosition(position.amount0, position.tickLower, position.tickUpper, position.liquidity);

        LiquidityGrowthFullRangeVaultV3 vault = LiquidityGrowthFullRangeVaultV3(payable(result.growthVault));
        configurationHash = vault.configurationHash();
        if (
            configurationHash == bytes32(0)
                || growthVaultFactory.configurationHashOf(result.growthVault) != configurationHash
                || vault.poolId() != result.poolId || vault.token() != result.token
                || address(vault.feeHook()) != address(feeHook)
                || address(vault.positionManager()) != address(positionManager)
                || vault.initialTokenDust() != result.initialLockedTokenDust
                || vault.accountedTokenDust() != result.initialLockedTokenDust
        ) revert InvalidVault(result.growthVault);
    }

    function _recordLaunch(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        bytes32 graffiti,
        address deployer
    ) private returns (bytes32 launchHash) {
        bytes32 parametersHash = keccak256(abi.encode(parameters, graffiti));
        bytes32 resultHash = keccak256(
            abi.encode(
                result.token,
                result.poolId,
                result.growthVault,
                result.positionRecipient,
                result.positionTokenId,
                result.initialBuyNativeAmount,
                result.initialBuyTokenAmount,
                result.initialLockedTokenDust,
                result.vaultConfigurationHash
            )
        );
        launchHash = keccak256(abi.encode(block.chainid, address(this), deployer, parametersHash, resultHash));
        launchHashOf[result.token] = launchHash;
        growthVaultOf[result.token] = result.growthVault;
        emit LiquidityGrowthFullRangeTokenLaunchedV3(
            deployer,
            result.token,
            result.poolId,
            address(feeHook),
            result.growthVault,
            result.positionRecipient,
            result.positionTokenId,
            result.vaultConfigurationHash,
            launchHash
        );
        emit LiquidityGrowthFullRangeConfiguredV3(
            result.token,
            TOKEN_SUPPLY,
            result.initialLockedTokenDust,
            TOTAL_HOOK_FEE_BPS,
            GROWTH_FEE_BPS,
            PROGRAMMABLE_FEE_BPS,
            INITIAL_TICK,
            Policy.FULL_RANGE_TICK_LOWER,
            Policy.FULL_RANGE_TICK_UPPER,
            launchHash
        );
        emit LiquidityGrowthFullRangeCreatorInitialBuyV3(
            deployer,
            result.token,
            result.poolId,
            result.initialBuyNativeAmount,
            result.initialBuyTokenAmount,
            parameters.initialBuySqrtPriceLimitX96,
            launchHash
        );
    }

    function _validateLaunch(LaunchParameters calldata parameters, uint256 nativeAmount) private view {
        _validateMetadata(parameters);
        if (nativeAmount < MIN_INITIAL_BUY_WEI) {
            revert InitialBuyBelowMinimum(nativeAmount, MIN_INITIAL_BUY_WEI);
        }
        if (parameters.deadline < block.timestamp) {
            revert LaunchDeadlineExpired(parameters.deadline, block.timestamp);
        }
        if (parameters.minimumInitialTokenOut == 0) revert InvalidMinimumTokenOutput();
        uint160 initialPrice = Policy.initialSqrtPriceX96();
        if (
            parameters.initialBuySqrtPriceLimitX96 < MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96
                || parameters.initialBuySqrtPriceLimitX96 >= initialPrice
        ) {
            revert InvalidInitialBuyPriceLimit(
                parameters.initialBuySqrtPriceLimitX96, MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96, initialPrice
            );
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
        if (nameBytes > Policy.MAX_TOKEN_NAME_BYTES) {
            revert TokenNameTooLong(nameBytes, Policy.MAX_TOKEN_NAME_BYTES);
        }
        if (symbolBytes > Policy.MAX_TOKEN_SYMBOL_BYTES) {
            revert TokenSymbolTooLong(symbolBytes, Policy.MAX_TOKEN_SYMBOL_BYTES);
        }
        if (descriptionBytes > Policy.MAX_TOKEN_DESCRIPTION_BYTES) {
            revert TokenDescriptionTooLong(descriptionBytes, Policy.MAX_TOKEN_DESCRIPTION_BYTES);
        }
        if (websiteBytes > Policy.MAX_METADATA_URL_BYTES) {
            revert MetadataWebsiteTooLong(websiteBytes, Policy.MAX_METADATA_URL_BYTES);
        }
        if (imageBytes > Policy.MAX_METADATA_URL_BYTES) {
            revert MetadataImageTooLong(imageBytes, Policy.MAX_METADATA_URL_BYTES);
        }
        if (extraDataBytes > Policy.MAX_SOCIAL_EXTRA_DATA_BYTES) {
            revert MetadataExtraDataTooLong(extraDataBytes, Policy.MAX_SOCIAL_EXTRA_DATA_BYTES);
        }
    }

    function _effectiveGraffiti(address deployer, bytes32 creatorSalt) private pure returns (bytes32) {
        return keccak256(abi.encode(deployer, creatorSalt));
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
