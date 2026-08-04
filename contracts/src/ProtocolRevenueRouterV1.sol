// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FixedPoint96 } from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

interface IProtocolRevenueUniversalRouterV1 {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IProtocolRevenueMainHookV1 {
    function launcherFeeRecipient() external view returns (address);

    function poolFeeConfig(bytes32 poolId)
        external
        view
        returns (
            address creator,
            address registrar,
            uint16 totalSwapFeeBps,
            bool registered,
            uint256 creatorFeesAccrued
        );
}

/// @title ProtocolRevenueRouterV1
/// @notice Applies Programmable's immutable protocol-revenue policy to newly claimed native ETH.
/// @dev Each cycle sends 50% of the exact claim amount to the fixed treasury, reserves 0.5% for the fixed keeper's
///      gas, and swaps the remaining 49.5% for $V4 through Uniswap's official Universal Router. Purchased $V4 is
///      delivered to the fixed revenue wallet. The contract is non-upgradeable and exposes no owner, recovery,
///      arbitrary-call, liquidity-management or configuration surface.
contract ProtocolRevenueRouterV1 is ReentrancyGuardTransient {
    using Address for address payable;
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    uint16 public constant BASIS_POINTS = 10_000;
    uint16 public constant TREASURY_SHARE_BPS = 5000;
    uint16 public constant BUY_SHARE_BPS = 4950;
    uint16 public constant KEEPER_GAS_SHARE_BPS = 50;
    uint16 public constant MAIN_POOL_SWAP_FEE_BPS = 100;

    uint64 public constant CYCLE_INTERVAL = 1 days;
    uint64 public constant MAX_CYCLE_TIMESTAMP_AGE = 6 hours;
    uint256 public constant MIN_NEW_REVENUE = 0.001 ether;
    uint256 public constant EXECUTION_DEADLINE = 5 minutes;
    uint256 public constant MAX_NATIVE_SWAP_CHUNK = 0.1 ether;
    uint256 public constant MAX_SWAP_CHUNKS = 32;
    int24 public constant MAX_SWAP_TICK_MOVE = 100;
    int24 public constant MAX_TOTAL_SWAP_TICK_MOVE = 500;
    int24 public constant MAX_REFERENCE_TICK_DEVIATION = 100;
    int24 public constant TICK_SPACING = 200;

    uint8 private constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 private constant SETTLE_ALL = 0x0c;
    uint8 private constant TAKE_ALL = 0x0f;
    uint8 private constant UR_V4_SWAP = 0x10;

    address public constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant TREASURY = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address public constant V4_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    address public constant MAIN_HOOK = 0x025a386eAa79f6067d29848FD05ccC71bEAb20CC;
    address public immutable keeper;

    IPoolManager public constant POOL_MANAGER = IPoolManager(0x000000000004444c5dc75cB358380D2e3dE08A90);
    IProtocolRevenueUniversalRouterV1 public constant UNIVERSAL_ROUTER =
        IProtocolRevenueUniversalRouterV1(0xd92A36B0000531EF3063dEd4De20A0783308446C);

    bytes32 public constant MAIN_POOL_ID = 0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0;

    bytes32 private constant V4_TOKEN_CODE_HASH = 0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad;
    bytes32 private constant MAIN_HOOK_CODE_HASH = 0x274e29fb8d19f0607533ac7582827db0236ab546bb393d52049229b2ffe74381;
    bytes32 private constant POOL_MANAGER_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 private constant UNIVERSAL_ROUTER_CODE_HASH =
        0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49;

    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    uint64 public lastProcessedAt;
    uint256 public cycleCount;
    uint256 public totalRevenueProcessed;
    uint256 public totalTreasurySent;
    uint256 public totalKeeperGasSent;
    uint256 public totalNativeSwapped;
    uint256 public totalTokensBought;

    error ClaimedRevenueExceedsBalance(uint256 claimedRevenue, uint256 availableBalance);
    error CodeHashMismatch(address target, bytes32 expected, bytes32 actual);
    error CooldownActive(uint256 nextRunAt);
    error CycleTimestampTooOld(uint64 cycleTimestamp, uint256 oldestAllowed);
    error CycleTimestampInFuture(uint64 cycleTimestamp, uint256 latestAllowed);
    error DependencyBindingMismatch();
    error InsufficientNewRevenue(uint256 actual, uint256 minimum);
    error InvalidKeeper(address keeper);
    error InvalidPoolState();
    error OnlyRevenueAuthority(address caller);
    error ReferenceTickDeviationTooLarge(int24 referenceTick, int24 currentTick, int24 maximum);
    error SwapDirectionInvalid(int24 tickBefore, int24 tickAfter);
    error SwapAmountExceedsCycleCapacity(uint256 actual, uint256 maximum);
    error SwapOutputBelowMinimum(uint256 actual, uint256 minimum);
    error SwapTickMoveTooLarge(int24 tickBefore, int24 tickAfter, int24 maximum);
    error SwapTotalTickMoveTooLarge(int24 tickBefore, int24 tickAfter, int24 maximum);

    event RevenueProcessed(
        uint256 indexed cycle,
        uint256 claimedRevenue,
        uint256 treasuryAmount,
        uint256 keeperGasAmount,
        uint256 nativeSwapped,
        uint256 tokenBought,
        address indexed tokenRecipient
    );

    constructor(address keeper_) {
        if (block.chainid != 1) revert DependencyBindingMismatch();
        if (keeper_ == address(0) || keeper_ == REVENUE_AUTHORITY || keeper_ == TREASURY) {
            revert InvalidKeeper(keeper_);
        }
        keeper = keeper_;
        _assertCodeHash(V4_TOKEN, V4_TOKEN_CODE_HASH);
        _assertCodeHash(MAIN_HOOK, MAIN_HOOK_CODE_HASH);
        _assertCodeHash(address(POOL_MANAGER), POOL_MANAGER_CODE_HASH);
        _assertCodeHash(address(UNIVERSAL_ROUTER), UNIVERSAL_ROUTER_CODE_HASH);

        PoolKey memory key = mainPoolKey();
        if (PoolId.unwrap(key.toId()) != MAIN_POOL_ID) revert DependencyBindingMismatch();
        IProtocolRevenueMainHookV1 hook = IProtocolRevenueMainHookV1(MAIN_HOOK);
        if (hook.launcherFeeRecipient() != REVENUE_AUTHORITY) revert DependencyBindingMismatch();
        (,, uint16 totalSwapFeeBps, bool registered,) = hook.poolFeeConfig(MAIN_POOL_ID);
        if (!registered || totalSwapFeeBps != MAIN_POOL_SWAP_FEE_BPS) revert DependencyBindingMismatch();

        (uint160 sqrtPriceX96,, uint24 protocolFee, uint24 lpFee) = POOL_MANAGER.getSlot0(PoolId.wrap(MAIN_POOL_ID));
        if (sqrtPriceX96 == 0 || protocolFee != 0 || lpFee != 0) revert InvalidPoolState();
    }

    receive() external payable { }

    /// @notice Processes exactly `claimedRevenue` from the current atomic claim batch.
    /// @dev Any pre-existing or accidentally donated ETH remains untouched because the split never uses the full
    ///      contract balance. The immutable revenue authority is the only caller accepted.
    function process(uint64 cycleTimestamp, int24 referenceTick, uint256 claimedRevenue) external nonReentrant {
        if (msg.sender != REVENUE_AUTHORITY) revert OnlyRevenueAuthority(msg.sender);
        uint256 latestAllowed = block.timestamp + EXECUTION_DEADLINE;
        if (cycleTimestamp > latestAllowed) revert CycleTimestampInFuture(cycleTimestamp, latestAllowed);
        uint256 oldestAllowed = 0;
        // Six-hour report freshness is insensitive to a validator's seconds of timestamp discretion.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > MAX_CYCLE_TIMESTAMP_AGE) oldestAllowed = block.timestamp - MAX_CYCLE_TIMESTAMP_AGE;
        if (cycleTimestamp == 0 || cycleTimestamp < oldestAllowed) {
            revert CycleTimestampTooOld(cycleTimestamp, oldestAllowed);
        }
        uint256 eligibleAt = uint256(lastProcessedAt) + CYCLE_INTERVAL;
        // The 24-hour minimum cadence is insensitive to a validator's seconds of timestamp discretion.
        // forge-lint: disable-next-line(block-timestamp)
        if (lastProcessedAt != 0 && block.timestamp < eligibleAt) revert CooldownActive(eligibleAt);
        _validateReferenceTick(referenceTick, currentMainPoolTick());
        if (claimedRevenue < MIN_NEW_REVENUE) {
            revert InsufficientNewRevenue(claimedRevenue, MIN_NEW_REVENUE);
        }
        uint256 availableBalance = address(this).balance;
        if (claimedRevenue > availableBalance) {
            revert ClaimedRevenueExceedsBalance(claimedRevenue, availableBalance);
        }

        uint256 nativeToSwap = FullMath.mulDiv(claimedRevenue, BUY_SHARE_BPS, BASIS_POINTS);
        uint256 keeperGasAmount = FullMath.mulDiv(claimedRevenue, KEEPER_GAS_SHARE_BPS, BASIS_POINTS);
        uint256 treasuryAmount = claimedRevenue - nativeToSwap - keeperGasAmount;
        payable(TREASURY).sendValue(treasuryAmount);
        payable(keeper).sendValue(keeperGasAmount);
        uint256 tokenBought = _buyV4(nativeToSwap, referenceTick);
        IERC20(V4_TOKEN).safeTransfer(REVENUE_AUTHORITY, tokenBought);

        // Mainnet timestamps fit in uint64 for the lifetime of this immutable deployment.
        // forge-lint: disable-next-line(unsafe-typecast)
        lastProcessedAt = uint64(block.timestamp);
        unchecked {
            ++cycleCount;
        }
        totalRevenueProcessed += claimedRevenue;
        totalTreasurySent += treasuryAmount;
        totalKeeperGasSent += keeperGasAmount;
        totalNativeSwapped += nativeToSwap;
        totalTokensBought += tokenBought;

        emit RevenueProcessed(
            cycleCount, claimedRevenue, treasuryAmount, keeperGasAmount, nativeToSwap, tokenBought, REVENUE_AUTHORITY
        );
    }

    function _buyV4(uint256 nativeToSwap, int24 referenceTick) private returns (uint256 tokenBought) {
        uint256 maximumCycleSwap = MAX_NATIVE_SWAP_CHUNK * MAX_SWAP_CHUNKS;
        if (nativeToSwap > maximumCycleSwap) {
            revert SwapAmountExceedsCycleCapacity(nativeToSwap, maximumCycleSwap);
        }

        (, int24 startingTick,,) = POOL_MANAGER.getSlot0(PoolId.wrap(MAIN_POOL_ID));
        _validateReferenceTick(referenceTick, startingTick);
        uint256 tokenBalanceBeforeSwap = IERC20(V4_TOKEN).balanceOf(address(this));
        uint256 nativeRemaining = nativeToSwap;
        while (nativeRemaining != 0) {
            uint256 chunk = nativeRemaining > MAX_NATIVE_SWAP_CHUNK ? MAX_NATIVE_SWAP_CHUNK : nativeRemaining;
            (uint160 sqrtPriceBefore, int24 tickBefore,,) = POOL_MANAGER.getSlot0(PoolId.wrap(MAIN_POOL_ID));
            uint128 minimumTokenOut = _minimumTokenOut(chunk, tickBefore);
            uint256 tokenBalanceBeforeChunk = IERC20(V4_TOKEN).balanceOf(address(this));
            _swapNativeForToken(chunk, minimumTokenOut);
            uint256 tokenBoughtInChunk = IERC20(V4_TOKEN).balanceOf(address(this)) - tokenBalanceBeforeChunk;
            if (tokenBoughtInChunk < minimumTokenOut) {
                revert SwapOutputBelowMinimum(tokenBoughtInChunk, minimumTokenOut);
            }

            (uint160 sqrtPriceAfter, int24 tickAfter,,) = POOL_MANAGER.getSlot0(PoolId.wrap(MAIN_POOL_ID));
            _validateSwapTicks(tickBefore, tickAfter);
            _validateTotalSwapTicks(startingTick, tickAfter);
            if (sqrtPriceAfter >= sqrtPriceBefore) revert SwapDirectionInvalid(tickBefore, tickAfter);
            nativeRemaining -= chunk;
        }

        tokenBought = IERC20(V4_TOKEN).balanceOf(address(this)) - tokenBalanceBeforeSwap;
        if (tokenBought == 0) revert SwapOutputBelowMinimum(0, 1);
    }

    function ready(uint256 claimedRevenue) external view returns (bool) {
        // A daily cadence is insensitive to the few seconds of validator timestamp discretion.
        // forge-lint: disable-next-line(block-timestamp)
        if (lastProcessedAt != 0 && block.timestamp < uint256(lastProcessedAt) + CYCLE_INTERVAL) return false;
        return claimedRevenue >= MIN_NEW_REVENUE && address(this).balance >= claimedRevenue;
    }

    function nextRunAt() external view returns (uint256) {
        if (lastProcessedAt == 0) return block.timestamp;
        return uint256(lastProcessedAt) + CYCLE_INTERVAL;
    }

    /// @notice ETH present but not assigned to a reviewed claim batch. Automation never includes it implicitly.
    function unallocatedNativeBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function mainPoolKey() public pure returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(V4_TOKEN),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(MAIN_HOOK)
        });
    }

    function currentMainPoolTick() public view returns (int24 tick) {
        (, tick,,) = POOL_MANAGER.getSlot0(PoolId.wrap(MAIN_POOL_ID));
    }

    function _swapNativeForToken(uint256 amountIn, uint128 amountOutMinimum) private {
        ExactInputSingleParams memory swap = ExactInputSingleParams({
            poolKey: mainPoolKey(),
            zeroForOne: true,
            amountIn: _toUint128(amountIn),
            amountOutMinimum: amountOutMinimum,
            minHopPriceX36: 0,
            hookData: ""
        });
        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory actionParameters = new bytes[](3);
        actionParameters[0] = abi.encode(swap);
        actionParameters[1] = abi.encode(address(0), amountIn);
        actionParameters[2] = abi.encode(V4_TOKEN, uint256(amountOutMinimum));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParameters);
        UNIVERSAL_ROUTER.execute{ value: amountIn }(
            abi.encodePacked(UR_V4_SWAP), inputs, block.timestamp + EXECUTION_DEADLINE
        );
    }

    function _minimumTokenOut(uint256 grossNativeIn, int24 tickBefore) private pure returns (uint128 minimumOut) {
        int24 minimumTick = tickBefore - MAX_SWAP_TICK_MOVE;
        if (minimumTick <= TickMath.MIN_TICK) revert InvalidPoolState();
        uint160 minimumSqrtPriceX96 = TickMath.getSqrtPriceAtTick(minimumTick);
        uint256 minimumPriceX96 =
            FullMath.mulDiv(uint256(minimumSqrtPriceX96), uint256(minimumSqrtPriceX96), FixedPoint96.Q96);
        uint256 nativeAfterHookFee = FullMath.mulDiv(grossNativeIn, BASIS_POINTS - MAIN_POOL_SWAP_FEE_BPS, BASIS_POINTS);
        minimumOut = _toUint128(FullMath.mulDiv(nativeAfterHookFee, minimumPriceX96, FixedPoint96.Q96));
        if (minimumOut == 0) revert SwapOutputBelowMinimum(0, 1);
    }

    function _validateSwapTicks(int24 tickBefore, int24 tickAfter) private pure {
        if (tickAfter > tickBefore) revert SwapDirectionInvalid(tickBefore, tickAfter);
        int256 tickMove = int256(tickBefore) - int256(tickAfter);
        if (tickMove > int256(MAX_SWAP_TICK_MOVE)) {
            revert SwapTickMoveTooLarge(tickBefore, tickAfter, MAX_SWAP_TICK_MOVE);
        }
    }

    function _validateTotalSwapTicks(int24 tickBefore, int24 tickAfter) private pure {
        if (tickAfter > tickBefore) revert SwapDirectionInvalid(tickBefore, tickAfter);
        int256 tickMove = int256(tickBefore) - int256(tickAfter);
        if (tickMove > int256(MAX_TOTAL_SWAP_TICK_MOVE)) {
            revert SwapTotalTickMoveTooLarge(tickBefore, tickAfter, MAX_TOTAL_SWAP_TICK_MOVE);
        }
    }

    function _validateReferenceTick(int24 referenceTick, int24 currentTick) private pure {
        int256 difference = int256(referenceTick) - int256(currentTick);
        if (difference < 0) difference = -difference;
        if (difference > int256(MAX_REFERENCE_TICK_DEVIATION)) {
            revert ReferenceTickDeviationTooLarge(referenceTick, currentTick, MAX_REFERENCE_TICK_DEVIATION);
        }
    }

    function _assertCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert CodeHashMismatch(target, expected, actual);
    }

    function _toUint128(uint256 value) private pure returns (uint128 narrowed) {
        if (value > type(uint128).max) revert InvalidPoolState();
        // The explicit upper-bound check above makes this narrowing exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        narrowed = uint128(value);
    }
}
