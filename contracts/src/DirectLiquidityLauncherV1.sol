// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
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
/// @notice Opens fixed-supply Uniswap UERC20 tokens against ETH with creator-supplied Uniswap v4 liquidity.
/// @dev A launch can create a new token or use a provenance-verified existing UERC20. The initial LP NFT is minted
///      directly to Launcher’s permanently locked fee forwarder.
contract DirectLiquidityLauncherV1 is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

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

    struct ExistingUERC20LaunchParameters {
        address token;
        uint256 tokenLiquidityAmount;
        uint160 initialSqrtPriceX96;
        bytes32 hookSalt;
    }

    struct LockedPositionInput {
        address token;
        address positionRecipient;
        address creator;
        uint256 tokenLiquidityBudget;
        uint160 initialSqrtPriceX96;
    }

    error EmptyName();
    error EmptySymbol();
    error InvalidDependency(address dependency);
    error InvalidInitialPrice(uint160 initialSqrtPriceX96);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidSupply(uint256 totalSupply, uint256 tokenLiquidityAmount);
    error InvalidToken(address token);
    error LiquidityBudgetTooLarge(uint256 nativeLiquidityBudget, uint256 tokenLiquidityBudget);
    error NoNativeLiquidity();
    error ExistingTokenCreatorMismatch(address token, address expectedCreator, address caller);
    error ExistingTokenAlreadyLaunched(address token);
    error ExistingTokenNotFromFactory(address token, address predictedToken);
    error TokenTransferMismatch(address token, uint256 expected, uint256 actual);
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

    event ExistingUERC20Launched(
        address indexed creator,
        address indexed token,
        address indexed hook,
        address positionRecipient,
        uint256 positionTokenId,
        bytes32 poolId,
        bytes32 provenanceHash,
        bytes32 launchHash
    );

    event ExistingUERC20LiquidityConfigured(
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

    /// @notice Returns the deterministic locked position recipient for an existing-UERC20 launch.
    function predictExistingPositionRecipient(address token, address creator) external view returns (address) {
        return positionForwarderFactory.predict(_existingPositionSalt(token, creator), creator);
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
        result.positionRecipient = _deployOrReusePositionRecipient(_positionSalt(result.token, msg.sender), msg.sender);

        _createToken(parameters, effectiveGraffiti, result.token);

        _mintLockedPosition(
            result,
            LockedPositionInput({
                token: result.token,
                positionRecipient: result.positionRecipient,
                creator: msg.sender,
                tokenLiquidityBudget: parameters.tokenLiquidityAmount,
                initialSqrtPriceX96: parameters.initialSqrtPriceX96
            }),
            hook
        );

        // ReentrancyGuardTransient protects the complete launch; Slither does not recognize its transient lock.
        // slither-disable-next-line reentrancy-benign
        result.launchHash = _recordLaunch(parameters, result, hook.configurationHash(), msg.sender);
    }

    /// @notice Opens a locked ETH pool for an existing token created by the configured official UERC20Factory.
    /// @dev The factory-recorded token creator must call and provide the token and ETH liquidity budgets.
    // slither-disable-next-line reentrancy-eth
    function launchExistingUERC20(ExistingUERC20LaunchParameters calldata parameters)
        external
        payable
        nonReentrant
        returns (LaunchResult memory result)
    {
        _validateExistingLaunch(parameters);
        if (launchHashOf[parameters.token] != bytes32(0)) {
            revert ExistingTokenAlreadyLaunched(parameters.token);
        }

        (uint256 totalSupply, bytes32 provenanceHash) = _validateExistingUERC20(parameters.token, msg.sender);
        _pullTokenExactly(parameters.token, msg.sender, parameters.tokenLiquidityAmount);

        result.token = parameters.token;
        PlatformFeeHookV1 hook = _deployOrReuseHook(result.token, parameters.hookSalt);
        result.hook = address(hook);
        result.positionRecipient =
            _deployOrReusePositionRecipient(_existingPositionSalt(result.token, msg.sender), msg.sender);

        _mintLockedPosition(
            result,
            LockedPositionInput({
                token: result.token,
                positionRecipient: result.positionRecipient,
                creator: msg.sender,
                tokenLiquidityBudget: parameters.tokenLiquidityAmount,
                initialSqrtPriceX96: parameters.initialSqrtPriceX96
            }),
            hook
        );

        // ReentrancyGuardTransient protects the complete launch; Slither does not recognize its transient lock.
        // slither-disable-next-line reentrancy-benign
        result.launchHash = _recordExistingLaunch(
            parameters, result, totalSupply, provenanceHash, hook.configurationHash(), msg.sender
        );
    }

    function _mintLockedPosition(LaunchResult memory result, LockedPositionInput memory input, PlatformFeeHookV1 hook)
        private
    {
        Currency tokenCurrency = Currency.wrap(input.token);
        PoolKey memory poolKey = hook.poolKey();
        int24 initialTick = poolManager.initialize(poolKey, input.initialSqrtPriceX96);
        int24 expectedTick = TickMath.getTickAtSqrtPrice(input.initialSqrtPriceX96);
        if (initialTick != expectedTick) revert InvalidInitialTick(initialTick, expectedTick);

        Plan memory plan;
        (plan, result.nativeLiquidityAmount, result.tokenLiquidityAmount) =
            _buildFullRangePlan(input, poolKey, hook.TICK_SPACING());
        result.positionTokenId = positionManager.nextTokenId();

        tokenCurrency.transfer(address(positionManager), input.tokenLiquidityBudget);
        positionManager.modifyLiquidities{ value: msg.value }(abi.encode(plan.actions, plan.params), block.timestamp);

        uint256 creatorTokenAmount = tokenCurrency.balanceOfSelf();
        if (creatorTokenAmount != 0) tokenCurrency.transfer(input.creator, creatorTokenAmount);

        result.poolId = PoolId.unwrap(poolKey.toId());
    }

    function _buildFullRangePlan(LockedPositionInput memory input, PoolKey memory poolKey, int24 tickSpacing)
        private
        view
        returns (Plan memory plan, uint256 nativeLiquidityAmount, uint256 tokenLiquidityAmount)
    {
        PositionDefinition[] memory definitions = new PositionDefinition[](0);
        CurrencyAmounts memory available = CurrencyAmounts({ amount0: msg.value, amount1: input.tokenLiquidityBudget });
        (Position[] memory positions, CurrencyAmounts memory remaining) = PositionPlanner.resolve(
            definitions, input.initialSqrtPriceX96, tickSpacing, available, input.positionRecipient
        );
        if (positions.length != 1) revert UnexpectedPositionCount(positions.length);

        plan = PositionPlanner.toPlan(positions, poolKey, input.creator);
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

    function _recordExistingLaunch(
        ExistingUERC20LaunchParameters calldata parameters,
        LaunchResult memory result,
        uint256 totalSupply,
        bytes32 provenanceHash,
        bytes32 hookConfigurationHash,
        address creator
    ) private returns (bytes32 launchHash) {
        bytes32 infrastructureHash = keccak256(
            abi.encode(
                creator,
                result.token,
                result.hook,
                result.positionRecipient,
                result.positionTokenId,
                result.poolId,
                provenanceHash
            )
        );
        bytes32 liquidityHash = keccak256(
            abi.encode(
                totalSupply,
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

        emit ExistingUERC20Launched(
            creator,
            result.token,
            result.hook,
            result.positionRecipient,
            result.positionTokenId,
            result.poolId,
            provenanceHash,
            launchHash
        );
        emit ExistingUERC20LiquidityConfigured(
            result.token,
            totalSupply,
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

    function _deployOrReusePositionRecipient(bytes32 salt, address creator) private returns (address recipient) {
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
        _validateLiquidity(parameters.tokenLiquidityAmount, parameters.initialSqrtPriceX96);
    }

    function _validateExistingLaunch(ExistingUERC20LaunchParameters calldata parameters) private view {
        if (parameters.token == address(0) || parameters.token.code.length == 0) {
            revert InvalidToken(parameters.token);
        }
        if (parameters.tokenLiquidityAmount == 0) {
            revert InvalidSupply(0, parameters.tokenLiquidityAmount);
        }
        _validateLiquidity(parameters.tokenLiquidityAmount, parameters.initialSqrtPriceX96);
    }

    function _validateLiquidity(uint256 tokenLiquidityAmount, uint160 initialSqrtPriceX96) private view {
        if (msg.value == 0) revert NoNativeLiquidity();
        if (msg.value > type(uint128).max || tokenLiquidityAmount > type(uint128).max) {
            revert LiquidityBudgetTooLarge(msg.value, tokenLiquidityAmount);
        }
        if (initialSqrtPriceX96 < TickMath.MIN_SQRT_PRICE || initialSqrtPriceX96 >= TickMath.MAX_SQRT_PRICE) {
            revert InvalidInitialPrice(initialSqrtPriceX96);
        }
    }

    function _validateExistingUERC20(address token, address caller)
        private
        view
        returns (uint256 totalSupply, bytes32 provenanceHash)
    {
        UERC20 existingToken = UERC20(token);
        address recordedCreator = existingToken.creator();
        if (recordedCreator != caller) {
            revert ExistingTokenCreatorMismatch(token, recordedCreator, caller);
        }

        string memory tokenName = existingToken.name();
        string memory tokenSymbol = existingToken.symbol();
        uint8 tokenDecimals = existingToken.decimals();
        bytes32 tokenGraffiti = existingToken.graffiti();
        address predictedToken =
            tokenFactory.getUERC20Address(tokenName, tokenSymbol, tokenDecimals, recordedCreator, tokenGraffiti);
        if (predictedToken != token) revert ExistingTokenNotFromFactory(token, predictedToken);

        totalSupply = existingToken.totalSupply();
        provenanceHash = keccak256(
            abi.encode(
                address(tokenFactory),
                token,
                recordedCreator,
                tokenGraffiti,
                keccak256(bytes(tokenName)),
                keccak256(bytes(tokenSymbol)),
                tokenDecimals,
                totalSupply
            )
        );
    }

    function _pullTokenExactly(address token, address from, uint256 amount) private {
        IERC20 existingToken = IERC20(token);
        uint256 balanceBefore = existingToken.balanceOf(address(this));
        existingToken.safeTransferFrom(from, address(this), amount);
        uint256 balanceAfter = existingToken.balanceOf(address(this));
        uint256 received = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : 0;
        if (received != amount) revert TokenTransferMismatch(token, amount, received);
    }

    function _effectiveGraffiti(address creator, bytes32 creatorSalt) private pure returns (bytes32) {
        return keccak256(abi.encode(creator, creatorSalt));
    }

    function _positionSalt(address token, address creator) private pure returns (bytes32) {
        return keccak256(abi.encode("launcher.direct-position.v1", token, creator));
    }

    function _existingPositionSalt(address token, address creator) private pure returns (bytes32) {
        return keccak256(abi.encode("launcher.existing-uerc20-position.v1", token, creator));
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }
}
