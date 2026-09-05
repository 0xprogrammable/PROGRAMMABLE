// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {RobinhoodNative20Token} from "./RobinhoodNative20Token.sol";
import {RobinhoodNativeFeeHookV1} from "./robinhood-fee-v1/RobinhoodNativeFeeHookV1.sol";

/// @notice One-shot, graph-factory-only token-side liquidity seed. The position is permanently owned here.
/// @dev There is deliberately no remove/collect/approve/operator/sweep/arbitrary execution entry point.
///      It seeds actual v4 concentrated liquidity with token inventory, not synthetic ETH reserves.
///      ETH enters when buyers trade. Transaction gas still requires real ETH.
contract RobinhoodNative20Initializer is IUnlockCallback {
    address public constant CANONICAL_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address public constant CANONICAL_GRAPH_FACTORY = 0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd;
    uint24 public constant LP_FEE_PIPS = 0;
    int24 public constant TICK_SPACING = 60;
    int24 public constant TICK_LOWER = 160_020;
    int24 public constant TICK_UPPER = 200_040;
    bytes32 public constant POSITION_SALT = bytes32(0);

    IPoolManager public immutable poolManager;
    address public immutable graphFactory;
    bool public initialized;
    address public token;
    address public hook;
    uint128 public lockedLiquidity;
    uint256 public seededTokenAmount;
    bytes32 private pendingUnlock;

    error InvalidEnvironment();
    error UnauthorizedFactory();
    error AlreadyInitialized();
    error InvalidInventory();
    error InvalidHookBinding();
    error InvalidUnlock();
    error UnexpectedLiquidityDelta();
    error TokenSettlementMismatch();

    event TokenInventorySeeded(
        address indexed token, address indexed hook, uint128 lockedLiquidity, uint256 tokenAmount
    );

    constructor(IPoolManager manager, address factory) {
        if (
            block.chainid != 4663 || address(manager) != CANONICAL_POOL_MANAGER || address(manager).code.length == 0
                || factory != CANONICAL_GRAPH_FACTORY
        ) revert InvalidEnvironment();
        poolManager = manager;
        graphFactory = factory;
    }

    function initialSqrtPriceX96() public pure returns (uint160) {
        return TickMath.getSqrtPriceAtTick(TICK_UPPER);
    }

    /// @notice Called only after the graph factory has deployed initializer, token and fee kernel.
    /// @dev Deferred initialization avoids a CREATE2 constructor-reference cycle between initializer and hook.
    function initialize(address token_, address hook_) external {
        if (msg.sender != graphFactory) revert UnauthorizedFactory();
        if (initialized) revert AlreadyInitialized();
        if (token_.codehash != keccak256(type(RobinhoodNative20Token).runtimeCode)) revert InvalidInventory();
        uint256 inventory = RobinhoodNative20Token(token_).balanceOf(address(this));
        if (inventory != RobinhoodNative20Token(token_).totalSupply()) revert InvalidInventory();
        RobinhoodNativeFeeHookV1 feeHook = RobinhoodNativeFeeHookV1(hook_);
        if (
            address(feeHook.poolManager()) != address(poolManager) || feeHook.token() != token_
                || feeHook.initializer() != address(this) || feeHook.initialSqrtPriceX96() != initialSqrtPriceX96()
                || feeHook.lpFee() != LP_FEE_PIPS || feeHook.tickSpacing() != TICK_SPACING
                || feeHook.module() != address(0)
        ) revert InvalidHookBinding();

        uint256 liquidity = FullMath.mulDiv(
            inventory, 1 << 96, uint256(initialSqrtPriceX96()) - TickMath.getSqrtPriceAtTick(TICK_LOWER)
        );
        if (liquidity == 0 || liquidity > uint128(type(int128).max)) revert InvalidInventory();
        initialized = true;
        token = token_;
        hook = hook_;
        lockedLiquidity = uint128(liquidity);
        PoolKey memory key = _poolKey();
        poolManager.initialize(key, initialSqrtPriceX96());
        bytes memory data = abi.encode(token_, hook_, lockedLiquidity);
        pendingUnlock = keccak256(data);
        bytes memory result = poolManager.unlock(data);
        if (pendingUnlock != bytes32(0) || result.length != 0 || seededTokenAmount == 0) revert InvalidUnlock();
        emit TokenInventorySeeded(token_, hook_, lockedLiquidity, seededTokenAmount);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || pendingUnlock == bytes32(0) || keccak256(data) != pendingUnlock) {
            revert InvalidUnlock();
        }
        pendingUnlock = bytes32(0);
        (BalanceDelta delta, BalanceDelta feesAccrued) = poolManager.modifyLiquidity(
            _poolKey(),
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: int256(uint256(lockedLiquidity)),
                salt: POSITION_SALT
            }),
            ""
        );
        if (delta.amount0() != 0 || delta.amount1() >= 0 || BalanceDelta.unwrap(feesAccrued) != 0) {
            revert UnexpectedLiquidityDelta();
        }
        uint256 owed = uint256(-int256(delta.amount1()));
        seededTokenAmount = owed;
        poolManager.sync(Currency.wrap(token));
        if (!RobinhoodNative20Token(token).transfer(address(poolManager), owed)) revert TokenSettlementMismatch();
        if (poolManager.settle() != owed) revert TokenSettlementMismatch();
        return "";
    }

    function _poolKey() private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
    }
}
