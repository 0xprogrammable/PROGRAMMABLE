// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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

import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";
import { QuoteAssetCreatorFeeHookV1 } from "./QuoteAssetCreatorFeeHookV1.sol";
import { QuoteAssetFeeSplitVaultFactoryV1 } from "./QuoteAssetFeeSplitVaultFactoryV1.sol";
import { QuoteAssetFeeSplitVaultV1 } from "./QuoteAssetFeeSplitVaultV1.sol";
import { StockPairedPositionPlannerV1 } from "./StockPairedPositionPlannerV1.sol";
import { StockQuoteRegistryV1 } from "./StockQuoteRegistryV1.sol";
import { IQuoteAssetCreatorFeeHookV1 } from "./interfaces/IQuoteAssetCreatorFeeHookV1.sol";

/// @title StockPairedLaunchV1
/// @notice Atomically launches a fixed-supply token into a locked v4 pool quoted in an accepted stock token.
contract StockPairedLaunchV1 is IUnlockCallback, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for *;
    using SafeERC20 for IERC20;

    uint8 public constant TOKEN_DECIMALS = 18;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MIN_INITIAL_BUY_QUOTE_AMOUNT = 0.01 ether;
    uint256 public constant MAX_TOKEN_NAME_BYTES = 48;
    uint256 public constant MAX_TOKEN_SYMBOL_BYTES = 12;
    uint256 public constant MAX_TOKEN_DESCRIPTION_BYTES = 280;
    uint256 public constant MAX_METADATA_URL_BYTES = 2048;
    uint256 public constant MAX_SOCIAL_EXTRA_DATA_BYTES = 1200;
    uint256 public constant MAX_REWARD_BENEFICIARIES = 8;
    uint16 public constant REWARD_SHARE_BASIS_POINTS = 10_000;
    int24 public constant INITIAL_ABSOLUTE_TICK = 191_200;
    int24 public constant TICK_SPACING = 200;
    uint24 public constant LP_FEE_PIPS = 0;

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    UERC20Factory public immutable tokenFactory;
    QuoteAssetCreatorFeeHookV1 public immutable feeHook;
    StockQuoteRegistryV1 public immutable quoteRegistry;
    StockPairedPositionPlannerV1 public immutable positionPlanner;
    QuoteAssetFeeSplitVaultFactoryV1 public immutable feeSplitVaultFactory;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;

    mapping(address token => bytes32 launchHash) public launchHashOf;
    mapping(address token => address rewardVault) public rewardVaultOf;
    mapping(address token => address quoteAsset) public quoteAssetOf;

    struct LaunchParameters {
        string name;
        string symbol;
        address quoteAsset;
        uint256 initialBuyQuoteAmount;
        bytes32 creatorSalt;
        UERC20Metadata metadata;
        address[] rewardBeneficiaries;
        uint16[] rewardSharesBps;
    }

    struct LaunchResult {
        address token;
        address quoteAsset;
        address rewardVault;
        address positionRecipient;
        uint256 positionTokenId;
        uint256 tokenLiquidityAmount;
        uint256 lockedTokenDust;
        uint256 initialBuyQuoteAmount;
        uint256 initialBuyTokenAmount;
        int24 initialTick;
        bool quoteIsCurrency0;
        bytes32 poolId;
        bytes32 quoteConfigurationHash;
        bytes32 launchHash;
    }

    struct InitialBuyCallbackData {
        PoolKey key;
        address creator;
        address quoteAsset;
        address token;
        uint256 quoteAmount;
        bool quoteIsCurrency0;
    }

    error DuplicateRewardBeneficiary(address beneficiary);
    error EmptyName();
    error EmptySymbol();
    error InitialBuyBelowMinimum(uint256 actual, uint256 minimum);
    error InvalidBeneficiaryCount(uint256 count);
    error InvalidDependency(address dependency);
    error InvalidInitialBuyDelta(int128 quoteDelta, int128 tokenDelta);
    error InvalidInitialBuyResult(uint256 tokenAmount, uint256 residualQuoteBalance);
    error InvalidInitialBuySettlement(uint256 actual, uint256 expected);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidPositionPlanner(address planner, bytes32 actualCodeHash, bytes32 expectedCodeHash);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidQuoteTransfer(uint256 actual, uint256 expected);
    error InvalidRewardBeneficiary(address beneficiary);
    error InvalidRewardShare(address beneficiary, uint16 shareBps);
    error InvalidRewardShareTotal(uint256 totalShareBps);
    error InvalidSharedHook(address expectedPoolManager, uint24 lpFeePips, int24 tickSpacing);
    error InvalidVaultFactory(address expected, address actual);
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

    event StockPairedTokenLaunched(
        address indexed deployer,
        address indexed token,
        address indexed quoteAsset,
        bytes32 poolId,
        address rewardVault,
        address positionRecipient,
        uint256 positionTokenId,
        bytes32 launchHash
    );
    event StockPairedLiquidityConfigured(
        address indexed token,
        address indexed quoteAsset,
        uint256 totalSupply,
        uint256 tokenLiquidityAmount,
        uint256 lockedTokenDust,
        int24 initialTick,
        int24 tickLower,
        int24 tickUpper,
        uint24 lpFeePips,
        bytes32 launchHash
    );
    event StockPairedCreatorInitialBuy(
        address indexed deployer,
        address indexed token,
        address indexed quoteAsset,
        bytes32 poolId,
        uint256 quoteAmount,
        uint256 tokenAmount,
        bytes32 launchHash
    );

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        UERC20Factory tokenFactory_,
        QuoteAssetCreatorFeeHookV1 feeHook_,
        StockQuoteRegistryV1 quoteRegistry_,
        StockPairedPositionPlannerV1 positionPlanner_,
        QuoteAssetFeeSplitVaultFactoryV1 feeSplitVaultFactory_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_
    ) {
        _requireContract(address(poolManager_));
        _requireContract(address(positionManager_));
        _requireContract(address(tokenFactory_));
        _requireContract(address(feeHook_));
        _requireContract(address(quoteRegistry_));
        _requireContract(address(positionPlanner_));
        _requireContract(address(feeSplitVaultFactory_));
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
        if (address(feeHook_.quoteRegistry()) != address(quoteRegistry_)) {
            revert InvalidDependency(address(quoteRegistry_));
        }
        // slither-disable-next-line too-many-digits
        bytes32 expectedPlannerCodeHash = keccak256(type(StockPairedPositionPlannerV1).runtimeCode);
        bytes32 actualPlannerCodeHash = address(positionPlanner_).codehash;
        if (actualPlannerCodeHash != expectedPlannerCodeHash) {
            revert InvalidPositionPlanner(address(positionPlanner_), actualPlannerCodeHash, expectedPlannerCodeHash);
        }
        address configuredVaultFactory = address(feeHook_.feeSplitVaultFactory());
        if (configuredVaultFactory != address(feeSplitVaultFactory_)) {
            revert InvalidVaultFactory(address(feeSplitVaultFactory_), configuredVaultFactory);
        }

        poolManager = poolManager_;
        positionManager = positionManager_;
        tokenFactory = tokenFactory_;
        feeHook = feeHook_;
        quoteRegistry = quoteRegistry_;
        positionPlanner = positionPlanner_;
        feeSplitVaultFactory = feeSplitVaultFactory_;
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

    function predictPositionRecipient(address token, address quoteAsset, address deployer)
        external
        view
        returns (address)
    {
        return positionForwarderFactory.predict(_positionSalt(token, quoteAsset, deployer), deployer);
    }

    function predictRewardVault(
        address token,
        address quoteAsset,
        address deployer,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external view returns (address) {
        PoolKey memory key = _poolKey(token, quoteAsset);
        bytes32 poolId = PoolId.unwrap(key.toId());
        return feeSplitVaultFactory.predict(
            _rewardVaultSalt(token, quoteAsset, deployer),
            IQuoteAssetCreatorFeeHookV1(address(feeHook)),
            poolId,
            IERC20(quoteAsset),
            beneficiaries,
            sharesBps
        );
    }

    /// @notice Creates the token, locked position and initial stock-token buy in one atomic transaction.
    function launch(LaunchParameters calldata parameters) external nonReentrant returns (LaunchResult memory result) {
        _validateLaunch(parameters);
        if (parameters.initialBuyQuoteAmount < MIN_INITIAL_BUY_QUOTE_AMOUNT) {
            revert InitialBuyBelowMinimum(parameters.initialBuyQuoteAmount, MIN_INITIAL_BUY_QUOTE_AMOUNT);
        }
        result.quoteAsset = parameters.quoteAsset;
        result.initialBuyQuoteAmount = parameters.initialBuyQuoteAmount;
        result.quoteConfigurationHash = quoteRegistry.assertAssetReady(parameters.quoteAsset);

        bytes32 effectiveGraffiti = _effectiveGraffiti(msg.sender, parameters.creatorSalt);
        result.token = tokenFactory.getUERC20Address(
            parameters.name, parameters.symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti
        );
        if (result.token.code.length != 0) revert TokenAlreadyExists(result.token);

        PoolKey memory key = _poolKey(result.token, parameters.quoteAsset);
        result.quoteIsCurrency0 = Currency.unwrap(key.currency0) == parameters.quoteAsset;
        result.initialTick = result.quoteIsCurrency0 ? INITIAL_ABSOLUTE_TICK : -INITIAL_ABSOLUTE_TICK;
        result.poolId = PoolId.unwrap(key.toId());
        result.rewardVault = _deployOrReuseRewardVault(
            result.token,
            parameters.quoteAsset,
            msg.sender,
            result.poolId,
            parameters.rewardBeneficiaries,
            parameters.rewardSharesBps
        );
        result.positionRecipient = _deployOrReusePositionRecipient(result.token, parameters.quoteAsset, msg.sender);
        _createToken(parameters, effectiveGraffiti, result.token);

        bytes32 registeredPoolId = feeHook.registerPool(key, result.rewardVault);
        assert(registeredPoolId == result.poolId);

        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(result.initialTick);
        int24 initializedTick = poolManager.initialize(key, initialSqrtPriceX96);
        if (initializedTick != result.initialTick) revert InvalidInitialTick(initializedTick, result.initialTick);

        Plan memory plan;
        Position memory position;
        (plan, position, result.lockedTokenDust) =
            positionPlanner.buildOneSidedPlan(key, result.positionRecipient, result.quoteIsCurrency0);
        result.positionTokenId = positionManager.nextTokenId();
        result.tokenLiquidityAmount = result.quoteIsCurrency0 ? position.amount1 : position.amount0;

        Currency.wrap(result.token).transfer(address(positionManager), TOKEN_SUPPLY);
        positionManager.modifyLiquidities(abi.encode(plan.actions, plan.params), block.timestamp);

        uint256 launcherTokenBalance = IERC20(result.token).balanceOf(address(this));
        uint256 positionManagerTokenBalance = IERC20(result.token).balanceOf(address(positionManager));
        if (launcherTokenBalance != 0 || positionManagerTokenBalance != 0) {
            revert TokenCustodyMismatch(launcherTokenBalance, positionManagerTokenBalance);
        }

        uint256 residualQuoteBalance = _pullQuoteExactly(parameters.quoteAsset, result.initialBuyQuoteAmount);
        result.initialBuyTokenAmount = _executeInitialBuy(key, msg.sender, result, residualQuoteBalance);
        result.launchHash = _recordLaunch(result, position, msg.sender);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);

        InitialBuyCallbackData memory callback = abi.decode(data, (InitialBuyCallbackData));
        bool zeroForOne = callback.quoteIsCurrency0;
        BalanceDelta delta = poolManager.swap(
            callback.key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -callback.quoteAmount.toInt256(),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        int128 quoteDelta = callback.quoteIsCurrency0 ? delta.amount0() : delta.amount1();
        int128 tokenDelta = callback.quoteIsCurrency0 ? delta.amount1() : delta.amount0();
        if (quoteDelta >= 0 || tokenDelta <= 0) revert InvalidInitialBuyDelta(quoteDelta, tokenDelta);

        uint256 quoteSettlement = (-int256(quoteDelta)).toUint256();
        if (quoteSettlement != callback.quoteAmount) {
            revert InvalidInitialBuySettlement(quoteSettlement, callback.quoteAmount);
        }
        uint256 tokenAmount = int256(tokenDelta).toUint256();

        Currency.wrap(callback.quoteAsset).settle(poolManager, address(this), quoteSettlement, false);
        Currency.wrap(callback.token).take(poolManager, callback.creator, tokenAmount, false);
        return abi.encode(tokenAmount);
    }

    function poolKey(address token, address quoteAsset) external view returns (PoolKey memory) {
        return _poolKey(token, quoteAsset);
    }

    function _pullQuoteExactly(address quoteAsset, uint256 amount) private returns (uint256 residualBalance) {
        IERC20 quoteToken = IERC20(quoteAsset);
        residualBalance = quoteToken.balanceOf(address(this));
        quoteToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = quoteToken.balanceOf(address(this)) - residualBalance;
        if (received != amount) revert InvalidQuoteTransfer(received, amount);
    }

    function _executeInitialBuy(
        PoolKey memory key,
        address creator,
        LaunchResult memory result,
        uint256 residualQuoteBalance
    ) private returns (uint256 tokenAmount) {
        bytes memory callbackResult = poolManager.unlock(
            abi.encode(
                InitialBuyCallbackData({
                    key: key,
                    creator: creator,
                    quoteAsset: result.quoteAsset,
                    token: result.token,
                    quoteAmount: result.initialBuyQuoteAmount,
                    quoteIsCurrency0: result.quoteIsCurrency0
                })
            )
        );
        tokenAmount = abi.decode(callbackResult, (uint256));
        uint256 quoteBalance = IERC20(result.quoteAsset).balanceOf(address(this));
        if (tokenAmount == 0 || quoteBalance != residualQuoteBalance) {
            revert InvalidInitialBuyResult(tokenAmount, quoteBalance);
        }
    }

    function _recordLaunch(LaunchResult memory result, Position memory position, address deployer)
        private
        returns (bytes32 launchHash)
    {
        bytes32 rewardConfigurationHash = QuoteAssetFeeSplitVaultV1(result.rewardVault).configurationHash();
        bytes32 infrastructureHash = _infrastructureHash(result, deployer, rewardConfigurationHash);
        bytes32 economicsHash = _economicsHash(result, position);
        launchHash = keccak256(abi.encode(block.chainid, address(this), infrastructureHash, economicsHash));
        launchHashOf[result.token] = launchHash;
        rewardVaultOf[result.token] = result.rewardVault;
        quoteAssetOf[result.token] = result.quoteAsset;

        emit StockPairedTokenLaunched(
            deployer,
            result.token,
            result.quoteAsset,
            result.poolId,
            result.rewardVault,
            result.positionRecipient,
            result.positionTokenId,
            launchHash
        );
        emit StockPairedLiquidityConfigured(
            result.token,
            result.quoteAsset,
            TOKEN_SUPPLY,
            result.tokenLiquidityAmount,
            result.lockedTokenDust,
            result.initialTick,
            position.tickLower,
            position.tickUpper,
            LP_FEE_PIPS,
            launchHash
        );
        emit StockPairedCreatorInitialBuy(
            deployer,
            result.token,
            result.quoteAsset,
            result.poolId,
            result.initialBuyQuoteAmount,
            result.initialBuyTokenAmount,
            launchHash
        );
    }

    function _infrastructureHash(LaunchResult memory result, address deployer, bytes32 rewardConfigurationHash)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                deployer,
                result.token,
                result.quoteAsset,
                address(feeHook),
                address(quoteRegistry),
                result.quoteConfigurationHash,
                result.rewardVault,
                rewardConfigurationHash,
                result.positionRecipient,
                result.positionTokenId,
                result.poolId
            )
        );
    }

    function _economicsHash(LaunchResult memory result, Position memory position) private view returns (bytes32) {
        bytes32 liquidityHash = keccak256(
            abi.encode(
                TOKEN_SUPPLY,
                result.tokenLiquidityAmount,
                result.lockedTokenDust,
                result.initialTick,
                position.tickLower,
                position.tickUpper,
                LP_FEE_PIPS
            )
        );
        bytes32 feeHash = keccak256(
            abi.encode(
                result.initialBuyQuoteAmount,
                result.initialBuyTokenAmount,
                feeHook.TOTAL_SWAP_FEE_BPS(),
                feeHook.CREATOR_FEE_BPS(),
                feeHook.LAUNCHER_FEE_BPS()
            )
        );
        return keccak256(abi.encode(liquidityHash, feeHash));
    }

    function _deployOrReusePositionRecipient(address token, address quoteAsset, address deployer)
        private
        returns (address recipient)
    {
        bytes32 salt = _positionSalt(token, quoteAsset, deployer);
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

    function _deployOrReuseRewardVault(
        address token,
        address quoteAsset,
        address deployer,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) private returns (address rewardVault) {
        bytes32 salt = _rewardVaultSalt(token, quoteAsset, deployer);
        rewardVault = feeSplitVaultFactory.predict(
            salt, IQuoteAssetCreatorFeeHookV1(address(feeHook)), poolId, IERC20(quoteAsset), beneficiaries, sharesBps
        );
        if (rewardVault.code.length == 0) {
            return address(
                feeSplitVaultFactory.deploy(
                    salt,
                    IQuoteAssetCreatorFeeHookV1(address(feeHook)),
                    poolId,
                    IERC20(quoteAsset),
                    beneficiaries,
                    sharesBps
                )
            );
        }

        QuoteAssetFeeSplitVaultV1 vault = QuoteAssetFeeSplitVaultV1(rewardVault);
        bytes32 recordedConfigurationHash = feeSplitVaultFactory.configurationHashOf(rewardVault);
        if (
            recordedConfigurationHash == bytes32(0) || vault.configurationHash() != recordedConfigurationHash
                || address(vault.feeHook()) != address(feeHook) || address(vault.poolManager()) != address(poolManager)
                || address(vault.quoteAsset()) != quoteAsset || vault.poolId() != poolId
        ) {
            revert UnrecognizedFactoryDeployment(rewardVault);
        }
    }

    function _createToken(LaunchParameters calldata parameters, bytes32 effectiveGraffiti, address predictedToken)
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

    function _poolKey(address token, address quoteAsset) private view returns (PoolKey memory key) {
        Currency tokenCurrency = Currency.wrap(token);
        Currency quoteCurrency = Currency.wrap(quoteAsset);
        (Currency currency0, Currency currency1) =
            token < quoteAsset ? (tokenCurrency, quoteCurrency) : (quoteCurrency, tokenCurrency);
        key = PoolKey({
            currency0: currency0, currency1: currency1, fee: LP_FEE_PIPS, tickSpacing: TICK_SPACING, hooks: feeHook
        });
    }

    function _validateLaunch(LaunchParameters calldata parameters) private pure {
        _validateMetadata(parameters);
        _validateRewardConfiguration(parameters.rewardBeneficiaries, parameters.rewardSharesBps);
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

    function _validateRewardConfiguration(address[] calldata beneficiaries, uint16[] calldata sharesBps) private pure {
        uint256 count = beneficiaries.length;
        if (count == 0 || count > MAX_REWARD_BENEFICIARIES || sharesBps.length != count) {
            revert InvalidBeneficiaryCount(count);
        }
        uint256 totalShareBps = 0;
        for (uint256 index; index < count; index++) {
            address beneficiary = beneficiaries[index];
            uint16 shareBps = sharesBps[index];
            if (beneficiary == address(0)) revert InvalidRewardBeneficiary(beneficiary);
            if (shareBps == 0) revert InvalidRewardShare(beneficiary, shareBps);
            for (uint256 prior; prior < index; prior++) {
                if (beneficiaries[prior] == beneficiary) {
                    revert DuplicateRewardBeneficiary(beneficiary);
                }
            }
            totalShareBps += shareBps;
        }
        if (totalShareBps != REWARD_SHARE_BASIS_POINTS) {
            revert InvalidRewardShareTotal(totalShareBps);
        }
    }

    function _effectiveGraffiti(address deployer, bytes32 creatorSalt) private pure returns (bytes32) {
        return keccak256(abi.encode(deployer, creatorSalt));
    }

    function _positionSalt(address token, address quoteAsset, address deployer) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.stock-paired-position.v1", token, quoteAsset, deployer));
    }

    function _rewardVaultSalt(address token, address quoteAsset, address deployer) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.stock-paired-reward-vault.v1", token, quoteAsset, deployer));
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
