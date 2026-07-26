// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { PositionPlanner } from "@uniswap/liquidity-launcher/src/libraries/PositionPlanner.sol";
import {
    CurrencyAmounts,
    Plan,
    Position,
    PositionDefinition
} from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";
import { PlatformFeeHookFactoryV1 } from "./PlatformFeeHookFactoryV1.sol";
import { PlatformFeeHookV1 } from "./PlatformFeeHookV1.sol";

/// @title DirectLiquidityLauncherV1
/// @notice Creates a fixed-supply token and opens its first ETH pool with creator-supplied Uniswap v4 liquidity.
/// @dev The launch is atomic. The initial LP NFT is minted directly to Launcher’s permanently locked fee forwarder.
contract DirectLiquidityLauncherV1 is ReentrancyGuardTransient {
    uint8 public constant TOKEN_DECIMALS = 18;

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    UERC20Factory public immutable tokenFactory;
    PlatformFeeHookFactoryV1 public immutable hookFactory;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;
    address public immutable platformFeeRecipient;

    mapping(address token => bytes32 launchHash) public launchHashOf;

    struct LaunchParameters {
        string name;
        string symbol;
        uint256 totalSupply;
        uint256 tokenLiquidityAmount;
        uint160 initialSqrtPriceX96;
        bytes32 creatorSalt;
        bytes32 hookSalt;
        UERC20Metadata metadata;
    }

    struct LaunchResult {
        address token;
        address hook;
        address positionRecipient;
        uint256 positionTokenId;
        uint256 nativeLiquidityAmount;
        uint256 tokenLiquidityAmount;
        bytes32 poolId;
        bytes32 launchHash;
    }

    error EmptyName();
    error EmptySymbol();
    error InvalidDependency(address dependency);
    error InvalidInitialPrice(uint160 initialSqrtPriceX96);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidSupply(uint256 totalSupply, uint256 tokenLiquidityAmount);
    error LiquidityBudgetTooLarge(uint256 nativeLiquidityBudget, uint256 tokenLiquidityBudget);
    error NoNativeLiquidity();
    error UnrecognizedFactoryDeployment(address deployment);
    error TokenAddressMismatch(address actual, address predicted);
    error TokenAlreadyExists(address token);
    error UnexpectedPositionCount(uint256 count);
    error ZeroAddress();

    event DirectTokenLaunched(
        address indexed creator,
        address indexed token,
        address indexed hook,
        address positionRecipient,
        uint256 positionTokenId,
        bytes32 poolId,
        bytes32 launchHash
    );

    event DirectLiquidityConfigured(
        address indexed token,
        uint256 totalSupply,
        uint256 tokenLiquidityAmount,
        uint256 nativeLiquidityAmount,
        uint256 tokenLiquidityBudget,
        uint256 nativeLiquidityBudget,
        uint160 initialSqrtPriceX96,
        bytes32 launchHash
    );

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        UERC20Factory tokenFactory_,
        PlatformFeeHookFactoryV1 hookFactory_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_,
        address platformFeeRecipient_
    ) {
        if (platformFeeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        _requireContract(address(poolManager_));
        _requireContract(address(positionManager_));
        _requireContract(address(tokenFactory_));
        _requireContract(address(hookFactory_));
        _requireContract(address(positionForwarderFactory_));

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
        hookFactory = hookFactory_;
        positionForwarderFactory = positionForwarderFactory_;
        platformFeeRecipient = platformFeeRecipient_;
    }

    /// @notice Returns the token address and effective factory graffiti for a creator-owned salt.
    function predictTokenAddress(string calldata name, string calldata symbol, address creator, bytes32 creatorSalt)
        external
        view
        returns (address token, bytes32 effectiveGraffiti)
    {
        effectiveGraffiti = _effectiveGraffiti(creator, creatorSalt);
        token = tokenFactory.getUERC20Address(name, symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti);
    }

    /// @notice Returns the deterministic locked position recipient used by a direct launch.
    function predictPositionRecipient(address token, address creator) external view returns (address) {
        return positionForwarderFactory.predict(_positionSalt(token, creator), creator);
    }

    /// @notice Atomically creates the token, initializes its bound v4 pool and mints locked full-range liquidity.
    function launch(LaunchParameters calldata parameters)
        external
        payable
        nonReentrant
        returns (LaunchResult memory result)
    {
        _validateLaunch(parameters);

        bytes32 effectiveGraffiti = _effectiveGraffiti(msg.sender, parameters.creatorSalt);
        result.token = tokenFactory.getUERC20Address(
            parameters.name, parameters.symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti
        );
        if (result.token.code.length != 0) revert TokenAlreadyExists(result.token);

        PlatformFeeHookV1 hook = _deployOrReuseHook(result.token, parameters.hookSalt);
        result.hook = address(hook);
        result.positionRecipient = _deployOrReusePositionRecipient(result.token, msg.sender);

        _createToken(parameters, effectiveGraffiti, result.token);

        (result.positionTokenId, result.poolId, result.nativeLiquidityAmount, result.tokenLiquidityAmount) =
            _mintLockedPosition(parameters, hook, result.token, result.positionRecipient, msg.sender);

        // ReentrancyGuardTransient protects the complete launch; Slither does not recognize its transient lock.
        // slither-disable-next-line reentrancy-benign
        result.launchHash = _recordLaunch(parameters, result, hook.configurationHash(), msg.sender);
    }

    function _mintLockedPosition(
        LaunchParameters calldata parameters,
        PlatformFeeHookV1 hook,
        address token,
        address positionRecipient,
        address creator
    )
        private
        returns (uint256 positionTokenId, bytes32 poolId, uint256 nativeLiquidityAmount, uint256 tokenLiquidityAmount)
    {
        Currency tokenCurrency = Currency.wrap(token);
        PoolKey memory poolKey = hook.poolKey();
        int24 initialTick = poolManager.initialize(poolKey, parameters.initialSqrtPriceX96);
        int24 expectedTick = TickMath.getTickAtSqrtPrice(parameters.initialSqrtPriceX96);
        if (initialTick != expectedTick) revert InvalidInitialTick(initialTick, expectedTick);

        Plan memory plan;
        (plan, nativeLiquidityAmount, tokenLiquidityAmount) =
            _buildFullRangePlan(parameters, poolKey, hook.TICK_SPACING(), positionRecipient, creator);
        positionTokenId = positionManager.nextTokenId();

        tokenCurrency.transfer(address(positionManager), parameters.tokenLiquidityAmount);
        positionManager.modifyLiquidities{ value: msg.value }(abi.encode(plan.actions, plan.params), block.timestamp);

        uint256 creatorTokenAmount = tokenCurrency.balanceOfSelf();
        if (creatorTokenAmount != 0) tokenCurrency.transfer(creator, creatorTokenAmount);

        poolId = PoolId.unwrap(poolKey.toId());
    }

    function _buildFullRangePlan(
        LaunchParameters calldata parameters,
        PoolKey memory poolKey,
        int24 tickSpacing,
        address positionRecipient,
        address creator
    ) private view returns (Plan memory plan, uint256 nativeLiquidityAmount, uint256 tokenLiquidityAmount) {
        PositionDefinition[] memory definitions = new PositionDefinition[](0);
        CurrencyAmounts memory available =
            CurrencyAmounts({ amount0: msg.value, amount1: parameters.tokenLiquidityAmount });
        (Position[] memory positions, CurrencyAmounts memory remaining) = PositionPlanner.resolve(
            definitions, parameters.initialSqrtPriceX96, tickSpacing, available, positionRecipient
        );
        if (positions.length != 1) revert UnexpectedPositionCount(positions.length);

        plan = PositionPlanner.toPlan(positions, poolKey, creator);
        nativeLiquidityAmount = available.amount0 - remaining.amount0;
        tokenLiquidityAmount = available.amount1 - remaining.amount1;
    }

    function _recordLaunch(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        bytes32 hookConfigurationHash,
        address creator
    ) private returns (bytes32 launchHash) {
        bytes32 infrastructureHash = keccak256(
            abi.encode(
                creator, result.token, result.hook, result.positionRecipient, result.positionTokenId, result.poolId
            )
        );
        bytes32 liquidityHash = keccak256(
            abi.encode(
                parameters.totalSupply,
                result.tokenLiquidityAmount,
                result.nativeLiquidityAmount,
                parameters.tokenLiquidityAmount,
                msg.value,
                parameters.initialSqrtPriceX96
            )
        );
        launchHash = keccak256(
            abi.encode(block.chainid, address(this), infrastructureHash, liquidityHash, hookConfigurationHash)
        );
        launchHashOf[result.token] = launchHash;

        emit DirectTokenLaunched(
            creator,
            result.token,
            result.hook,
            result.positionRecipient,
            result.positionTokenId,
            result.poolId,
            launchHash
        );
        emit DirectLiquidityConfigured(
            result.token,
            parameters.totalSupply,
            result.tokenLiquidityAmount,
            result.nativeLiquidityAmount,
            parameters.tokenLiquidityAmount,
            msg.value,
            parameters.initialSqrtPriceX96,
            launchHash
        );
    }

    function _deployOrReuseHook(address token, bytes32 hookSalt) private returns (PlatformFeeHookV1 hook) {
        address predicted = hookFactory.predict(
            hookSalt, poolManager, address(this), platformFeeRecipient, Currency.wrap(address(0)), Currency.wrap(token)
        );
        if (predicted.code.length == 0) {
            return hookFactory.deploy(
                hookSalt,
                poolManager,
                address(this),
                platformFeeRecipient,
                Currency.wrap(address(0)),
                Currency.wrap(token)
            );
        }

        hook = PlatformFeeHookV1(predicted);
        bytes32 configurationHash = hook.configurationHash();
        if (configurationHash == bytes32(0) || hookFactory.configurationHashOf(predicted) != configurationHash) {
            revert UnrecognizedFactoryDeployment(predicted);
        }
    }

    function _deployOrReusePositionRecipient(address token, address creator) private returns (address recipient) {
        bytes32 salt = _positionSalt(token, creator);
        recipient = positionForwarderFactory.predict(salt, creator);
        if (recipient.code.length == 0) {
            return address(positionForwarderFactory.deploy(salt, creator));
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

    function _createToken(LaunchParameters calldata parameters, bytes32 effectiveGraffiti, address predictedToken)
        private
    {
        address token = tokenFactory.createToken(
            parameters.name,
            parameters.symbol,
            TOKEN_DECIMALS,
            parameters.totalSupply,
            address(this),
            abi.encode(parameters.metadata),
            effectiveGraffiti
        );
        if (token != predictedToken) revert TokenAddressMismatch(token, predictedToken);
    }

    function _validateLaunch(LaunchParameters calldata parameters) private view {
        if (bytes(parameters.name).length == 0) revert EmptyName();
        if (bytes(parameters.symbol).length == 0) revert EmptySymbol();
        if (
            parameters.totalSupply == 0 || parameters.tokenLiquidityAmount == 0
                || parameters.tokenLiquidityAmount > parameters.totalSupply
        ) {
            revert InvalidSupply(parameters.totalSupply, parameters.tokenLiquidityAmount);
        }
        if (msg.value == 0) revert NoNativeLiquidity();
        if (msg.value > type(uint128).max || parameters.tokenLiquidityAmount > type(uint128).max) {
            revert LiquidityBudgetTooLarge(msg.value, parameters.tokenLiquidityAmount);
        }
        if (
            parameters.initialSqrtPriceX96 < TickMath.MIN_SQRT_PRICE
                || parameters.initialSqrtPriceX96 >= TickMath.MAX_SQRT_PRICE
        ) {
            revert InvalidInitialPrice(parameters.initialSqrtPriceX96);
        }
    }

    function _effectiveGraffiti(address creator, bytes32 creatorSalt) private pure returns (bytes32) {
        return keccak256(abi.encode(creator, creatorSalt));
    }

    function _positionSalt(address token, address creator) private pure returns (bytes32) {
        return keccak256(abi.encode("launcher.direct-position.v1", token, creator));
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
