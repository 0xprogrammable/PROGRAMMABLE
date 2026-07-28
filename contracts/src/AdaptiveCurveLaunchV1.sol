// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { Plan, Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { AdaptiveCurveFeeHookFactoryV1 } from "./AdaptiveCurveFeeHookFactoryV1.sol";
import { AdaptiveCurveFeeHookV1 } from "./AdaptiveCurveFeeHookV1.sol";
import { AdaptiveCurvePositionPlannerV1 } from "./AdaptiveCurvePositionPlannerV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";

/// @title AdaptiveCurveLaunchV1
/// @notice Atomically creates a fixed-supply token, an immutable adaptive-fee v4 hook and a permanently locked
/// one-sided liquidity position.
/// @dev The curve maps an ETH-denominated FDV index to a disclosed total native swap fee. The hook reads the
/// pre-swap tick and applies one symmetric fee to the complete buy or sell. The immutable Launcher share is exactly
/// 0.10 percentage points and is deducted from the selected total. Token transfers carry no tax. A creator may make
/// an initial buy in the launch transaction, but no liquidity deposit or initial buy is required.
contract AdaptiveCurveLaunchV1 is IUnlockCallback, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for *;

    uint8 public constant TOKEN_DECIMALS = 18;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_TOKEN_NAME_BYTES = 48;
    uint256 public constant MAX_TOKEN_SYMBOL_BYTES = 12;
    uint256 public constant MAX_TOKEN_DESCRIPTION_BYTES = 280;
    uint256 public constant MAX_METADATA_URL_BYTES = 2048;
    uint256 public constant MAX_SOCIAL_EXTRA_DATA_BYTES = 1200;
    int24 public constant INITIAL_TICK = 204_200;
    int24 public constant TICK_SPACING = 200;
    uint24 public constant LP_FEE_PIPS = 0;
    uint16 public constant MIN_TOTAL_SWAP_FEE_BPS = 100;
    uint16 public constant MAX_TOTAL_SWAP_FEE_BPS = 1000;
    uint8 public constant MIN_CURVE_POINTS = 2;
    uint8 public constant MAX_CURVE_POINTS = 8;
    int24 public constant MIN_FDV_INDEX = -TickMath.MAX_TICK;
    int24 public constant MAX_FDV_INDEX = TickMath.MAX_TICK;
    // Slither cannot build IR for the PoolManager callback that uses this constant.
    // slither-disable-next-line unused-state
    Currency private constant NATIVE = Currency.wrap(address(0));

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    UERC20Factory public immutable tokenFactory;
    AdaptiveCurveFeeHookFactoryV1 public immutable adaptiveHookFactory;
    AdaptiveCurvePositionPlannerV1 public immutable positionPlanner;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;
    address public immutable launcherFeeRecipient;

    mapping(address token => bytes32 launchHash) public launchHashOf;
    mapping(address token => LaunchRecord record) private _launchRecordOf;
    mapping(address hook => address token) public tokenOfHook;

    struct LaunchParameters {
        string name;
        string symbol;
        bytes32 creatorSalt;
        UERC20Metadata metadata;
        CurveConfiguration curve;
    }

    struct CurveConfiguration {
        bytes32 hookSaltNonce;
        int24[] fdvIndexes;
        uint16[] totalSwapFeeBps;
    }

    struct LaunchResult {
        address token;
        address feeHook;
        address positionRecipient;
        uint256 positionTokenId;
        uint256 initialBuyNativeAmount;
        uint256 initialBuyTokenAmount;
        bytes32 poolId;
        bytes32 curveHash;
        bytes32 launchHash;
    }

    struct LaunchRecord {
        address creator;
        address feeHook;
        address positionRecipient;
        uint256 positionTokenId;
        bytes32 poolId;
        bytes32 curveHash;
        bytes32 metadataHash;
        bytes32 launchHash;
    }

    struct LaunchAccounting {
        uint256 tokenLiquidityAmount;
        uint256 lockedTokenDust;
        bytes32 metadataHash;
    }

    struct PoolSetupResult {
        PoolKey key;
        Position position;
        uint256 positionTokenId;
        uint256 tokenLiquidityAmount;
        uint256 lockedTokenDust;
        bytes32 poolId;
        bytes32 curveHash;
    }

    struct InitialBuyCallbackData {
        PoolKey key;
        address creator;
        uint256 nativeAmount;
    }

    error AlreadyAssignedHook(address hook, address token);
    error CurveLengthMismatch(uint256 fdvIndexesLength, uint256 feeLength);
    error EmptyName();
    error EmptySymbol();
    error HookAddressFlagsMismatch(address hook, uint160 actualFlags, uint160 requiredFlags);
    error InvalidCurveEndpoint(int24 first, int24 last, int24 expectedFirst, int24 expectedLast);
    error InvalidCurveLength(uint256 length, uint256 minimum, uint256 maximum);
    error InvalidCurveOrder(uint256 index, int24 previous, int24 current);
    error InvalidDependency(address dependency);
    error InvalidFactoryHook(address hook);
    error InvalidInitialBuyDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidInitialBuyResult(uint256 tokenAmount, uint256 residualNativeBalance);
    error InvalidInitialBuySettlement(uint256 actual, uint256 expected);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidPositionPlanner(address planner, bytes32 actualCodeHash, bytes32 expectedCodeHash);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidTotalSwapFee(uint16 totalSwapFeeBps);
    error MetadataExtraDataTooLong(uint256 actualBytes, uint256 maximumBytes);
    error MetadataImageTooLong(uint256 actualBytes, uint256 maximumBytes);
    error MetadataWebsiteTooLong(uint256 actualBytes, uint256 maximumBytes);
    error TokenAddressMismatch(address actual, address predicted);
    error TokenAlreadyExists(address token);
    error TokenCustodyMismatch(uint256 launcherBalance, uint256 positionManagerBalance);
    error TokenDescriptionTooLong(uint256 actualBytes, uint256 maximumBytes);
    error TokenNameTooLong(uint256 actualBytes, uint256 maximumBytes);
    error TokenSymbolTooLong(uint256 actualBytes, uint256 maximumBytes);
    error UnauthorizedUnlockCallback(address caller);
    error UnrecognizedFactoryDeployment(address deployment);

    event AdaptiveTokenLaunched(
        address indexed creator, address indexed token, bytes32 indexed poolId, address feeHook, bytes32 launchHash
    );
    event AdaptiveLiquidityConfigured(
        address indexed token,
        uint256 totalSupply,
        uint256 tokenLiquidityAmount,
        uint256 lockedTokenDust,
        int24 initialTick,
        int24 tickLower,
        int24 tickUpper,
        uint24 lpFeePips,
        bytes32 launchHash
    );
    event AdaptiveCurveConfigured(
        address indexed token,
        bytes32 indexed poolId,
        address indexed feeHook,
        bytes32 curveHash,
        uint8 curvePointCount,
        bytes32 launchHash
    );
    event AdaptiveCreatorInitialBuy(
        address indexed creator,
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
        AdaptiveCurveFeeHookFactoryV1 adaptiveHookFactory_,
        AdaptiveCurvePositionPlannerV1 positionPlanner_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_,
        address launcherFeeRecipient_
    ) {
        _requireContract(address(poolManager_));
        _requireContract(address(positionManager_));
        _requireContract(address(tokenFactory_));
        _requireContract(address(adaptiveHookFactory_));
        _requireContract(address(positionPlanner_));
        _requireContract(address(positionForwarderFactory_));
        if (launcherFeeRecipient_ == address(0)) revert InvalidDependency(launcherFeeRecipient_);

        // slither-disable-next-line too-many-digits
        bytes32 expectedPlannerCodeHash = keccak256(type(AdaptiveCurvePositionPlannerV1).runtimeCode);
        bytes32 actualPlannerCodeHash = address(positionPlanner_).codehash;
        if (actualPlannerCodeHash != expectedPlannerCodeHash) {
            revert InvalidPositionPlanner(address(positionPlanner_), actualPlannerCodeHash, expectedPlannerCodeHash);
        }

        address positionManagerPoolManager = address(positionManager_.poolManager());
        if (positionManagerPoolManager != address(poolManager_)) {
            revert InvalidPositionManager(address(poolManager_), positionManagerPoolManager);
        }
        address factoryPositionManager = address(positionForwarderFactory_.positionManager());
        if (factoryPositionManager != address(positionManager_)) {
            revert InvalidPositionManagerFactory(address(positionManager_), factoryPositionManager);
        }

        poolManager = poolManager_;
        positionManager = positionManager_;
        tokenFactory = tokenFactory_;
        adaptiveHookFactory = adaptiveHookFactory_;
        positionPlanner = positionPlanner_;
        positionForwarderFactory = positionForwarderFactory_;
        launcherFeeRecipient = launcherFeeRecipient_;
    }

    function predictTokenAddress(string calldata name, string calldata symbol, address creator, bytes32 creatorSalt)
        external
        view
        returns (address token, bytes32 effectiveGraffiti)
    {
        effectiveGraffiti = _effectiveGraffiti(creator, creatorSalt);
        token = tokenFactory.getUERC20Address(name, symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti);
    }

    /// @notice Derives the creator-bound CREATE2 salt from a user-mined nonce.
    /// @dev A copied pending launch cannot consume the same hook because `creator` is part of the preimage.
    function effectiveHookSalt(address creator, bytes32 creatorSalt, bytes32 hookSaltNonce)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(creator, creatorSalt, hookSaltNonce));
    }

    /// @notice Predicts the Adaptive hook for one creator-bound launch nonce.
    function predictFeeHook(address creator, bytes32 creatorSalt, bytes32 hookSaltNonce) public view returns (address) {
        return adaptiveHookFactory.predict(
            effectiveHookSalt(creator, creatorSalt, hookSaltNonce), poolManager, launcherFeeRecipient
        );
    }

    function poolKey(address token, address feeHook) external pure returns (PoolKey memory) {
        return _poolKey(token, feeHook);
    }

    function launchRecord(address token) external view returns (LaunchRecord memory) {
        return _launchRecordOf[token];
    }

    /// @notice Creates and records the complete Adaptive launch in one transaction.
    function launch(bytes calldata encodedParameters)
        external
        payable
        nonReentrant
        returns (LaunchResult memory result)
    {
        LaunchParameters memory parameters = abi.decode(encodedParameters, (LaunchParameters));
        // Native ETH can be forced into any contract. Preserve that unrelated balance while proving this launch
        // consumes only its own msg.value.
        uint256 residualNativeBalance = address(this).balance - msg.value;
        LaunchAccounting memory accounting =
            LaunchAccounting({ tokenLiquidityAmount: 0, lockedTokenDust: 0, metadataHash: bytes32(0) });
        _validateLaunch(parameters);
        result.initialBuyNativeAmount = msg.value;

        bytes32 effectiveGraffiti = _effectiveGraffiti(msg.sender, parameters.creatorSalt);
        result.token = tokenFactory.getUERC20Address(
            parameters.name, parameters.symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti
        );
        if (result.token.code.length != 0) revert TokenAlreadyExists(result.token);

        result.feeHook = _deployOrReuseFeeHook(
            effectiveHookSalt(msg.sender, parameters.creatorSalt, parameters.curve.hookSaltNonce)
        );
        address assignedToken = tokenOfHook[result.feeHook];
        if (assignedToken != address(0)) revert AlreadyAssignedHook(result.feeHook, assignedToken);
        // ReentrancyGuardTransient protects the complete launch; Slither does not recognize its transient lock.
        // slither-disable-next-line reentrancy-benign
        tokenOfHook[result.feeHook] = result.token;

        result.positionRecipient = _deployOrReusePositionRecipient(result.token, msg.sender);
        _createToken(parameters, effectiveGraffiti, result.token);

        PoolSetupResult memory setup =
            _registerInitializeAndLock(parameters, result.token, result.feeHook, result.positionRecipient, msg.sender);
        result.positionTokenId = setup.positionTokenId;
        result.poolId = setup.poolId;
        result.curveHash = setup.curveHash;
        accounting.tokenLiquidityAmount = setup.tokenLiquidityAmount;
        accounting.lockedTokenDust = setup.lockedTokenDust;

        if (result.initialBuyNativeAmount != 0) {
            result.initialBuyTokenAmount = _executeInitialBuy(setup.key, msg.sender, result.initialBuyNativeAmount);
        }
        if (address(this).balance != residualNativeBalance) {
            revert InvalidInitialBuyResult(result.initialBuyTokenAmount, address(this).balance);
        }

        accounting.metadataHash = _metadataHash(parameters, effectiveGraffiti);
        // ReentrancyGuardTransient protects the complete launch; Slither does not recognize its transient lock.
        // slither-disable-next-line reentrancy-benign
        result.launchHash = _recordLaunch(parameters, result, accounting, setup.position, msg.sender);
    }

    function _registerInitializeAndLock(
        LaunchParameters memory parameters,
        address token,
        address feeHook,
        address positionRecipient,
        address creator
    ) private returns (PoolSetupResult memory setup) {
        setup.key = _poolKey(token, feeHook);
        AdaptiveCurveFeeHookV1 hook = AdaptiveCurveFeeHookV1(feeHook);
        setup.poolId =
            hook.registerPool(setup.key, creator, parameters.curve.fdvIndexes, parameters.curve.totalSwapFeeBps);
        // The remaining immutable registration fields are proven by the hook's registration tests and launch record.
        // slither-disable-next-line unused-return
        (,,, setup.curveHash,,,) = hook.poolFeeConfig(setup.poolId);

        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        int24 initializedTick = poolManager.initialize(setup.key, initialSqrtPriceX96);
        if (initializedTick != INITIAL_TICK) revert InvalidInitialTick(initializedTick, INITIAL_TICK);

        Plan memory plan;
        (plan, setup.position, setup.lockedTokenDust) = positionPlanner.buildOneSidedPlan(setup.key, positionRecipient);
        setup.positionTokenId = positionManager.nextTokenId();
        setup.tokenLiquidityAmount = setup.position.amount1;

        Currency.wrap(token).transfer(address(positionManager), TOKEN_SUPPLY);
        positionManager.modifyLiquidities(abi.encode(plan.actions, plan.params), block.timestamp);

        uint256 launcherTokenBalance = IERC20(token).balanceOf(address(this));
        uint256 positionManagerTokenBalance = IERC20(token).balanceOf(address(positionManager));
        if (launcherTokenBalance != 0 || positionManagerTokenBalance != 0) {
            revert TokenCustodyMismatch(launcherTokenBalance, positionManagerTokenBalance);
        }
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

    function _executeInitialBuy(PoolKey memory key, address creator, uint256 nativeAmount)
        private
        returns (uint256 tokenAmount)
    {
        uint256 residualNativeBalance = address(this).balance - nativeAmount;
        bytes memory result = poolManager.unlock(
            abi.encode(InitialBuyCallbackData({ key: key, creator: creator, nativeAmount: nativeAmount }))
        );
        tokenAmount = abi.decode(result, (uint256));
        if (tokenAmount == 0 || address(this).balance != residualNativeBalance) {
            revert InvalidInitialBuyResult(tokenAmount, address(this).balance);
        }
    }

    function _recordLaunch(
        LaunchParameters memory parameters,
        LaunchResult memory result,
        LaunchAccounting memory accounting,
        Position memory position,
        address creator
    ) private returns (bytes32 launchHash) {
        bytes32 infrastructureHash = keccak256(
            abi.encode(
                creator, result.token, result.feeHook, result.positionRecipient, result.positionTokenId, result.poolId
            )
        );
        bytes32 economicsHash = keccak256(
            abi.encode(
                TOKEN_SUPPLY,
                accounting.tokenLiquidityAmount,
                accounting.lockedTokenDust,
                result.initialBuyNativeAmount,
                result.initialBuyTokenAmount,
                INITIAL_TICK,
                position.tickLower,
                position.tickUpper,
                LP_FEE_PIPS,
                result.curveHash
            )
        );
        launchHash = keccak256(
            abi.encode(block.chainid, address(this), infrastructureHash, economicsHash, accounting.metadataHash)
        );
        launchHashOf[result.token] = launchHash;
        _launchRecordOf[result.token] = LaunchRecord({
            creator: creator,
            feeHook: result.feeHook,
            positionRecipient: result.positionRecipient,
            positionTokenId: result.positionTokenId,
            poolId: result.poolId,
            curveHash: result.curveHash,
            metadataHash: accounting.metadataHash,
            launchHash: launchHash
        });

        emit AdaptiveTokenLaunched(creator, result.token, result.poolId, result.feeHook, launchHash);
        emit AdaptiveLiquidityConfigured(
            result.token,
            TOKEN_SUPPLY,
            accounting.tokenLiquidityAmount,
            accounting.lockedTokenDust,
            INITIAL_TICK,
            position.tickLower,
            position.tickUpper,
            LP_FEE_PIPS,
            launchHash
        );
        emit AdaptiveCurveConfigured(
            result.token,
            result.poolId,
            result.feeHook,
            result.curveHash,
            uint8(parameters.curve.fdvIndexes.length),
            launchHash
        );
        emit AdaptiveCreatorInitialBuy(
            creator,
            result.token,
            result.poolId,
            result.initialBuyNativeAmount,
            result.initialBuyTokenAmount,
            launchHash
        );
    }

    function _deployOrReuseFeeHook(bytes32 effectiveSalt) private returns (address hookAddress) {
        hookAddress = adaptiveHookFactory.predict(effectiveSalt, poolManager, launcherFeeRecipient);
        uint160 actualFlags = uint160(hookAddress) & adaptiveHookFactory.ALL_HOOK_MASK();
        uint160 requiredFlags = adaptiveHookFactory.REQUIRED_HOOK_FLAGS();
        if (actualFlags != requiredFlags) {
            revert HookAddressFlagsMismatch(hookAddress, actualFlags, requiredFlags);
        }
        if (hookAddress.code.length == 0) {
            hookAddress = address(adaptiveHookFactory.deploy(effectiveSalt, poolManager, launcherFeeRecipient));
        }

        AdaptiveCurveFeeHookV1 hook = AdaptiveCurveFeeHookV1(hookAddress);
        if (
            adaptiveHookFactory.configurationHashOf(hookAddress) == bytes32(0)
                || address(hook.poolManager()) != address(poolManager)
                || hook.launcherFeeRecipient() != launcherFeeRecipient || hook.LP_FEE_PIPS() != LP_FEE_PIPS
                || hook.TICK_SPACING() != TICK_SPACING
        ) {
            revert InvalidFactoryHook(hookAddress);
        }
    }

    function _deployOrReusePositionRecipient(address token, address creator) private returns (address recipient) {
        recipient = positionForwarderFactory.predict(_positionSalt(token, creator), creator);
        if (recipient.code.length == 0) {
            return address(positionForwarderFactory.deploy(_positionSalt(token, creator), creator));
        }

        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(recipient));
        if (
            positionForwarderFactory.configurationHashOf(recipient) == bytes32(0)
                || address(forwarder.positionManager()) != address(positionManager)
                || forwarder.operator() != address(0) || forwarder.timelockBlockNumber() != type(uint256).max
                || forwarder.feeRecipient() != creator
        ) {
            revert UnrecognizedFactoryDeployment(recipient);
        }
    }

    function _createToken(LaunchParameters memory parameters, bytes32 effectiveGraffiti, address predictedToken)
        private
    {
        address token = tokenFactory.createToken(
            parameters.name,
            parameters.symbol,
            TOKEN_DECIMALS,
            TOKEN_SUPPLY,
            address(this),
            abi.encode(parameters.metadata),
            effectiveGraffiti
        );
        if (token != predictedToken) revert TokenAddressMismatch(token, predictedToken);
    }

    function _poolKey(address token, address feeHook) private pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: AdaptiveCurveFeeHookV1(feeHook)
        });
    }

    // slither-disable-next-line cyclomatic-complexity
    function _validateLaunch(LaunchParameters memory parameters) private pure {
        uint256 nameBytes = bytes(parameters.name).length;
        uint256 symbolBytes = bytes(parameters.symbol).length;
        uint256 descriptionBytes = bytes(parameters.metadata.description).length;
        uint256 websiteBytes = bytes(parameters.metadata.website).length;
        uint256 imageBytes = bytes(parameters.metadata.image).length;
        uint256 extraDataBytes = parameters.metadata.extraData.length;

        if (nameBytes == 0) revert EmptyName();
        if (symbolBytes == 0) revert EmptySymbol();
        if (nameBytes > MAX_TOKEN_NAME_BYTES) {
            revert TokenNameTooLong(nameBytes, MAX_TOKEN_NAME_BYTES);
        }
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

        uint256 length = parameters.curve.fdvIndexes.length;
        if (length != parameters.curve.totalSwapFeeBps.length) {
            revert CurveLengthMismatch(length, parameters.curve.totalSwapFeeBps.length);
        }
        if (length < MIN_CURVE_POINTS || length > MAX_CURVE_POINTS) {
            revert InvalidCurveLength(length, MIN_CURVE_POINTS, MAX_CURVE_POINTS);
        }
        if (parameters.curve.fdvIndexes[0] != MIN_FDV_INDEX || parameters.curve.fdvIndexes[length - 1] != MAX_FDV_INDEX)
        {
            revert InvalidCurveEndpoint(
                parameters.curve.fdvIndexes[0], parameters.curve.fdvIndexes[length - 1], MIN_FDV_INDEX, MAX_FDV_INDEX
            );
        }

        _validateTotalSwapFee(parameters.curve.totalSwapFeeBps[0]);
        for (uint256 i = 1; i < length; ++i) {
            if (parameters.curve.fdvIndexes[i] <= parameters.curve.fdvIndexes[i - 1]) {
                revert InvalidCurveOrder(i, parameters.curve.fdvIndexes[i - 1], parameters.curve.fdvIndexes[i]);
            }
            _validateTotalSwapFee(parameters.curve.totalSwapFeeBps[i]);
        }
    }

    function _validateTotalSwapFee(uint16 totalSwapFeeBps) private pure {
        if (totalSwapFeeBps < MIN_TOTAL_SWAP_FEE_BPS || totalSwapFeeBps > MAX_TOTAL_SWAP_FEE_BPS) {
            revert InvalidTotalSwapFee(totalSwapFeeBps);
        }
    }

    function _metadataHash(LaunchParameters memory parameters, bytes32 effectiveGraffiti)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                parameters.name,
                parameters.symbol,
                parameters.metadata.description,
                parameters.metadata.website,
                parameters.metadata.image,
                parameters.metadata.extraData,
                effectiveGraffiti
            )
        );
    }

    function _effectiveGraffiti(address creator, bytes32 creatorSalt) private pure returns (bytes32) {
        return keccak256(abi.encode(creator, creatorSalt));
    }

    function _positionSalt(address token, address creator) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.adaptive-position.v1", token, creator));
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
