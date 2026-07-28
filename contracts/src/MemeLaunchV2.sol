// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { EthCreatorFeeHookV3 } from "./EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "./FeeSplitVaultV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";
import { IClassicFeeHookV3 } from "./interfaces/IClassicFeeHookV3.sol";

/// @title MemeLaunchV2
/// @notice Launches a fixed-supply Classic token with immutable directional fees and beneficiary-owned rewards.
/// @dev This version preserves Classic V1's UERC20, pool, locked one-sided position and initial-buy mechanics.
///      Creator rewards use one immutable split vault for single-recipient, external-recipient and split launches.
contract MemeLaunchV2 is IUnlockCallback, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for *;

    uint8 public constant TOKEN_DECIMALS = 18;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    uint256 public constant MAX_TOKEN_NAME_BYTES = 48;
    uint256 public constant MAX_TOKEN_SYMBOL_BYTES = 12;
    uint256 public constant MAX_TOKEN_DESCRIPTION_BYTES = 280;
    uint256 public constant MAX_METADATA_URL_BYTES = 2048;
    uint256 public constant MAX_SOCIAL_EXTRA_DATA_BYTES = 1200;
    uint256 public constant MAX_REWARD_BENEFICIARIES = 8;
    uint16 public constant REWARD_SHARE_BASIS_POINTS = 10_000;
    int24 public constant INITIAL_TICK = 204_200;
    int24 public constant TICK_SPACING = 200;
    uint24 public constant LP_FEE_PIPS = 0;
    uint24 private constant POSITION_WEIGHT = 10_000_000;
    // Slither 0.11.5 cannot build IR for unlockCallback and consequently misses the native settlement use.
    // slither-disable-next-line unused-state
    Currency private constant NATIVE = Currency.wrap(address(0));

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    UERC20Factory public immutable tokenFactory;
    EthCreatorFeeHookV3 public immutable feeHook;
    FeeSplitVaultFactoryV1 public immutable feeSplitVaultFactory;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;

    mapping(address token => bytes32 launchHash) public launchHashOf;
    mapping(address token => address rewardVault) public rewardVaultOf;

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
        address rewardVault;
        address positionRecipient;
        uint256 positionTokenId;
        uint256 tokenLiquidityAmount;
        uint256 lockedTokenDust;
        uint256 initialBuyNativeAmount;
        uint256 initialBuyTokenAmount;
        bytes32 poolId;
        bytes32 launchHash;
    }

    struct InitialBuyCallbackData {
        PoolKey key;
        address creator;
        uint256 nativeAmount;
    }

    error DuplicateRewardBeneficiary(address beneficiary);
    error EmptyName();
    error EmptySymbol();
    error InitialBuyBelowMinimum(uint256 actual, uint256 minimum);
    error InvalidBeneficiaryCount(uint256 count);
    error InvalidDependency(address dependency);
    error InvalidInitialBuyDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidInitialBuyResult(uint256 tokenAmount, uint256 residualNativeBalance);
    error InvalidInitialBuySettlement(uint256 actual, uint256 expected);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidPosition(uint256 count, uint256 amount0, int24 tickLower, int24 tickUpper);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
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

    event MemeTokenLaunchedV2(
        address indexed deployer,
        address indexed token,
        bytes32 indexed poolId,
        address feeHook,
        address rewardVault,
        address positionRecipient,
        uint256 positionTokenId,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        bytes32 rewardConfigurationHash,
        bytes32 launchHash
    );
    event MemeLiquidityConfiguredV2(
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
    event MemeCreatorInitialBuyV2(
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
        EthCreatorFeeHookV3 feeHook_,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_
    ) {
        _requireContract(address(poolManager_));
        _requireContract(address(positionManager_));
        _requireContract(address(tokenFactory_));
        _requireContract(address(feeHook_));
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
        address configuredVaultFactory = address(feeHook_.feeSplitVaultFactory());
        if (configuredVaultFactory != address(feeSplitVaultFactory_)) {
            revert InvalidVaultFactory(address(feeSplitVaultFactory_), configuredVaultFactory);
        }

        poolManager = poolManager_;
        positionManager = positionManager_;
        tokenFactory = tokenFactory_;
        feeHook = feeHook_;
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

    function predictPositionRecipient(address token, address deployer) external view returns (address) {
        return positionForwarderFactory.predict(_positionSalt(token, deployer), deployer);
    }

    function predictRewardVault(
        address token,
        address deployer,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external view returns (address) {
        PoolKey memory key = _poolKey(token);
        bytes32 poolId = PoolId.unwrap(key.toId());
        return feeSplitVaultFactory.predict(
            _rewardVaultSalt(token, deployer), IClassicFeeHookV3(address(feeHook)), poolId, beneficiaries, sharesBps
        );
    }

    /// @notice Creates, registers, initializes and permanently positions a Classic V3 launch atomically.
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

        bytes32 effectiveGraffiti = _effectiveGraffiti(msg.sender, parameters.creatorSalt);
        result.token = tokenFactory.getUERC20Address(
            parameters.name, parameters.symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti
        );
        if (result.token.code.length != 0) revert TokenAlreadyExists(result.token);

        PoolKey memory key = _poolKey(result.token);
        result.poolId = PoolId.unwrap(key.toId());
        result.rewardVault = _deployOrReuseRewardVault(
            result.token, msg.sender, result.poolId, parameters.rewardBeneficiaries, parameters.rewardSharesBps
        );
        result.positionRecipient = _deployOrReusePositionRecipient(result.token, msg.sender);
        _createToken(parameters, effectiveGraffiti, result.token);

        bytes32 registeredPoolId =
            feeHook.registerPool(key, result.rewardVault, parameters.buySwapFeeBps, parameters.sellSwapFeeBps);
        assert(registeredPoolId == result.poolId);

        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        int24 initializedTick = poolManager.initialize(key, initialSqrtPriceX96);
        if (initializedTick != INITIAL_TICK) revert InvalidInitialTick(initializedTick, INITIAL_TICK);

        (Plan memory plan, Position memory position, uint256 lockedTokenDust) =
            _buildOneSidedPlan(key, result.positionRecipient, initialSqrtPriceX96);
        result.positionTokenId = positionManager.nextTokenId();
        result.tokenLiquidityAmount = position.amount1;
        result.lockedTokenDust = lockedTokenDust;

        Currency.wrap(result.token).transfer(address(positionManager), TOKEN_SUPPLY);
        positionManager.modifyLiquidities(abi.encode(plan.actions, plan.params), block.timestamp);

        uint256 launcherTokenBalance = IERC20(result.token).balanceOf(address(this));
        uint256 positionManagerTokenBalance = IERC20(result.token).balanceOf(address(positionManager));
        if (launcherTokenBalance != 0 || positionManagerTokenBalance != 0) {
            revert TokenCustodyMismatch(launcherTokenBalance, positionManagerTokenBalance);
        }

        result.initialBuyTokenAmount = _executeInitialBuy(key, msg.sender, result.initialBuyNativeAmount);
        // ReentrancyGuardTransient protects the complete launch; Slither does not model its transient lock.
        // slither-disable-next-line reentrancy-benign
        result.launchHash = _recordLaunch(parameters, result, position, msg.sender);
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

    function poolKey(address token) external view returns (PoolKey memory) {
        return _poolKey(token);
    }

    function _executeInitialBuy(PoolKey memory key, address deployer, uint256 nativeAmount)
        private
        returns (uint256 tokenAmount)
    {
        // Native ETH can be forced into any contract. Preserve that unrelated balance instead of allowing it to
        // permanently block launches, while still proving that this launch spent exactly `nativeAmount`.
        uint256 residualNativeBalance = address(this).balance - nativeAmount;
        bytes memory result = poolManager.unlock(
            abi.encode(InitialBuyCallbackData({ key: key, creator: deployer, nativeAmount: nativeAmount }))
        );
        tokenAmount = abi.decode(result, (uint256));
        if (tokenAmount == 0 || address(this).balance != residualNativeBalance) {
            revert InvalidInitialBuyResult(tokenAmount, address(this).balance);
        }
    }

    function _buildOneSidedPlan(PoolKey memory key, address positionRecipient, uint160 initialSqrtPriceX96)
        private
        pure
        returns (Plan memory plan, Position memory position, uint256 lockedTokenDust)
    {
        int24 minUsableTick = TickMath.minUsableTick(TICK_SPACING);
        PositionDefinition[] memory definitions = new PositionDefinition[](1);
        definitions[0] = PositionDefinition({
            offsetLower: minUsableTick - INITIAL_TICK,
            offsetUpper: 0,
            weight: POSITION_WEIGHT,
            overridePositionRecipient: positionRecipient
        });

        CurrencyAmounts memory available = CurrencyAmounts({ amount0: 0, amount1: TOKEN_SUPPLY });
        (Position[] memory positions, CurrencyAmounts memory remaining) =
            PositionPlanner.resolve(definitions, initialSqrtPriceX96, TICK_SPACING, available, positionRecipient);
        if (
            positions.length != 1 || positions[0].amount0 != 0 || positions[0].tickLower != minUsableTick
                || positions[0].tickUpper != INITIAL_TICK
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

    function _recordLaunch(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        Position memory position,
        address deployer
    ) private returns (bytes32 launchHash) {
        bytes32 rewardConfigurationHash = FeeSplitVaultV1(payable(result.rewardVault)).configurationHash();
        bytes32 infrastructureHash = _infrastructureHash(result, deployer, rewardConfigurationHash);
        bytes32 economicsHash = _economicsHash(parameters, result, position);
        launchHash = keccak256(abi.encode(block.chainid, address(this), infrastructureHash, economicsHash));
        launchHashOf[result.token] = launchHash;
        rewardVaultOf[result.token] = result.rewardVault;

        _emitLaunchEvents(parameters, result, position, deployer, rewardConfigurationHash, launchHash);
    }

    function _emitLaunchEvents(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        Position memory position,
        address deployer,
        bytes32 rewardConfigurationHash,
        bytes32 launchHash
    ) private {
        _emitTokenLaunched(parameters, result, deployer, rewardConfigurationHash, launchHash);
        emit MemeLiquidityConfiguredV2(
            result.token,
            TOKEN_SUPPLY,
            result.tokenLiquidityAmount,
            result.lockedTokenDust,
            INITIAL_TICK,
            position.tickLower,
            position.tickUpper,
            LP_FEE_PIPS,
            launchHash
        );
        emit MemeCreatorInitialBuyV2(
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
        bytes32 rewardConfigurationHash,
        bytes32 launchHash
    ) private {
        emit MemeTokenLaunchedV2(
            deployer,
            result.token,
            result.poolId,
            address(feeHook),
            result.rewardVault,
            result.positionRecipient,
            result.positionTokenId,
            parameters.buySwapFeeBps,
            parameters.sellSwapFeeBps,
            rewardConfigurationHash,
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
                address(feeHook),
                result.rewardVault,
                rewardConfigurationHash,
                result.positionRecipient,
                result.positionTokenId,
                result.poolId
            )
        );
    }

    function _economicsHash(LaunchParameters calldata parameters, LaunchResult memory result, Position memory position)
        private
        view
        returns (bytes32)
    {
        bytes32 liquidityHash = keccak256(
            abi.encode(
                TOKEN_SUPPLY,
                result.tokenLiquidityAmount,
                result.lockedTokenDust,
                INITIAL_TICK,
                position.tickLower,
                position.tickUpper,
                LP_FEE_PIPS
            )
        );
        bytes32 tradeHash = keccak256(
            abi.encode(
                MIN_INITIAL_BUY_WEI,
                result.initialBuyNativeAmount,
                result.initialBuyTokenAmount,
                parameters.buySwapFeeBps,
                parameters.sellSwapFeeBps,
                feeHook.LAUNCHER_FEE_BPS()
            )
        );
        return keccak256(abi.encode(liquidityHash, tradeHash));
    }

    function _deployOrReusePositionRecipient(address token, address deployer) private returns (address recipient) {
        recipient = positionForwarderFactory.predict(_positionSalt(token, deployer), deployer);
        if (recipient.code.length == 0) {
            return address(positionForwarderFactory.deploy(_positionSalt(token, deployer), deployer));
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
        address deployer,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) private returns (address rewardVault) {
        bytes32 salt = _rewardVaultSalt(token, deployer);
        rewardVault =
            feeSplitVaultFactory.predict(salt, IClassicFeeHookV3(address(feeHook)), poolId, beneficiaries, sharesBps);
        if (rewardVault.code.length == 0) {
            return address(
                feeSplitVaultFactory.deploy(salt, IClassicFeeHookV3(address(feeHook)), poolId, beneficiaries, sharesBps)
            );
        }

        FeeSplitVaultV1 vault = FeeSplitVaultV1(payable(rewardVault));
        bytes32 recordedConfigurationHash = feeSplitVaultFactory.configurationHashOf(rewardVault);
        if (
            recordedConfigurationHash == bytes32(0) || vault.configurationHash() != recordedConfigurationHash
                || address(vault.feeHook()) != address(feeHook) || address(vault.poolManager()) != address(poolManager)
                || vault.poolId() != poolId
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

    function _poolKey(address token) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: feeHook
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

    function _positionSalt(address token, address deployer) private pure returns (bytes32) {
        return keccak256(abi.encode("launcher.meme-position.v1", token, deployer));
    }

    function _rewardVaultSalt(address token, address deployer) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.classic-reward-vault.v1", token, deployer));
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
