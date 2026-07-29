// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { ProtocolFeeLibrary } from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { LiquidityGrowthFeeOracleHookFactoryV2 } from "../src/LiquidityGrowthFeeOracleHookFactoryV2.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthZapPlannerV3 } from "../src/LiquidityGrowthZapPlannerV3.sol";
import { ILiquidityGrowthFullRangeVaultFactoryV3 } from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthSwapMathV3 } from "../src/libraries/LiquidityGrowthSwapMathV3.sol";

contract DeepV3PlannerVaultFactory is ILiquidityGrowthFullRangeVaultFactoryV3 {
    mapping(address vault => bytes32 configurationHash) public configurationHashOf;

    function register(address vault) external {
        configurationHashOf[vault] = keccak256(abi.encode(block.chainid, address(this), vault));
    }
}

contract DeepV3PlannerToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Deep Planner Token", "DPL", 18) {
        creator = creator_;
    }
}

contract DeepV3PlannerVault is IUnlockCallback {
    using CurrencySettler for Currency;

    IPoolManager public immutable manager;
    int256 public lastDelta;

    error UnauthorizedCallback(address caller);

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function executeInternalSwap(
        LiquidityGrowthFeeOracleHookV2 hook,
        bytes32 poolId,
        PoolKey calldata key,
        uint256 swapNative,
        uint160 sqrtPriceLimitX96,
        bytes32 digest
    ) external {
        hook.armCompound(poolId, digest);
        manager.unlock(abi.encode(hook, key, swapNative, sqrtPriceLimitX96, digest));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert UnauthorizedCallback(msg.sender);
        (
            LiquidityGrowthFeeOracleHookV2 hook,
            PoolKey memory key,
            uint256 swapNative,
            uint160 sqrtPriceLimitX96,
            bytes32 digest
        ) = abi.decode(data, (LiquidityGrowthFeeOracleHookV2, PoolKey, uint256, uint160, bytes32));
        BalanceDelta delta = manager.swap(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(swapNative), sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            abi.encode(hook.COMPOUND_DOMAIN_TAG(), digest)
        );
        lastDelta = BalanceDelta.unwrap(delta);
        key.currency0.settle(manager, address(this), uint256(-int256(delta.amount0())), false);
        key.currency1.take(manager, address(this), uint256(int256(delta.amount1())), false);
        return "";
    }

    receive() external payable {
        if (msg.sender != address(manager)) revert UnauthorizedCallback(msg.sender);
    }
}

contract DeepV3SwapMathHarness {
    function simulate(LiquidityGrowthSwapMathV3.State calldata state, uint256 amountIn)
        external
        pure
        returns (LiquidityGrowthSwapMathV3.Result memory)
    {
        return LiquidityGrowthSwapMathV3.simulateExactInputZeroForOne(state, amountIn);
    }

    function maximumSteps() external pure returns (uint8) {
        return LiquidityGrowthSwapMathV3.maximumSteps();
    }
}

contract LiquidityGrowthZapPlannerV3Test is Deployers, IUnlockCallback {
    using CurrencySettler for Currency;
    using ProtocolFeeLibrary for uint24;
    using StateLibrary for IPoolManager;

    uint256 private constant INITIAL_BUY = 0.01 ether;
    uint256 private constant COMPOUND_BUDGET = 0.002 ether;
    Currency private constant NATIVE = Currency.wrap(address(0));

    LiquidityGrowthFeeOracleHookFactoryV2 private hookFactory;
    LiquidityGrowthFeeOracleHookV2 private hook;
    LiquidityGrowthZapPlannerV3 private planner;
    DeepV3PlannerVaultFactory private vaultFactory;
    DeepV3PlannerVault private growthVault;
    DeepV3PlannerToken private token;
    DeepV3SwapMathHarness private mathHarness;
    PoolKey private deepKey;
    bytes32 private poolId;
    address private treasury;

    PoolSwapTest.TestSettings private settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        treasury = makeAddr("deepV3PlannerTreasury");
        vaultFactory = new DeepV3PlannerVaultFactory();
        growthVault = new DeepV3PlannerVault(manager);
        vaultFactory.register(address(growthVault));
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV2();
        hook = _deployHook();
        planner = new LiquidityGrowthZapPlannerV3();
        mathHarness = new DeepV3SwapMathHarness();

        token = new DeepV3PlannerToken(address(this));
        token.mint(address(this), Policy.TOKEN_SUPPLY);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        deepKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: Policy.LP_FEE_PIPS,
            tickSpacing: Policy.TICK_SPACING,
            hooks: hook
        });
        poolId = PoolId.unwrap(deepKey.toId());
        hook.registerPool(deepKey, address(growthVault));
        manager.initialize(deepKey, Policy.initialSqrtPriceX96());
        modifyLiquidityRouter.modifyLiquidity(
            deepKey,
            ModifyLiquidityParams({
                tickLower: Policy.FULL_RANGE_TICK_LOWER,
                tickUpper: Policy.INITIAL_TICK,
                liquidityDelta: int256(1000 ether),
                salt: bytes32(uint256(1))
            }),
            abi.encode(hook.BOOTSTRAP_DOMAIN_TAG())
        );
        manager.unlock(abi.encode(uint8(1), INITIAL_BUY));
        hook.finalizePool(deepKey);
    }

    function test_optimizerFilesAndStepBoundAreFixed() public view {
        assertTrue(address(planner).code.length != 0);
        assertEq(mathHarness.maximumSteps(), 2);
    }

    function test_planConservesBudgetAndBindsOriginalPool() public {
        _matureOracle();
        (LiquidityGrowthZapPlannerV3.OracleQuote memory quote, LiquidityGrowthZapPlannerV3.CompoundPlan memory result) =
            planner.plan(deepKey, address(growthVault), 7, COMPOUND_BUDGET, 0);
        (uint160 currentSqrtPriceX96,,,) = manager.getSlot0(PoolId.wrap(poolId));

        assertEq(quote.spotSqrtPriceX96, currentSqrtPriceX96);
        assertGt(result.swapNative, 0);
        assertGt(result.expectedTokenOut, 0);
        assertGt(result.nativeForLiquidity, 0);
        assertGt(result.tokenForLiquidity, 0);
        assertGt(result.liquidity, 0);
        assertEq(result.budgetNative, result.swapNative + result.nativeForLiquidity + result.nativeDust);
        assertEq(result.expectedTokenOut, result.tokenForLiquidity + result.tokenDust);
        assertNotEq(result.digest, bytes32(0));
        assertLe(quote.spotTick - result.postSwapTick, Policy.MAX_INTERNAL_SWAP_IMPACT_TICKS);
    }

    function test_planIsLocallyOptimalAcrossRoundingNeighbors() public {
        _matureOracle();
        (LiquidityGrowthZapPlannerV3.OracleQuote memory quote, LiquidityGrowthZapPlannerV3.CompoundPlan memory result) =
            planner.plan(deepKey, address(growthVault), 11, COMPOUND_BUDGET, 0);

        uint256 distance = 1;
        for (uint8 index; index < 48; ++index) {
            if (result.swapNative > distance) {
                assertLe(
                    _candidateLiquidity(result.swapNative - distance, quote.sqrtPriceLimitX96, 0), result.liquidity
                );
            }
            if (result.swapNative + distance <= COMPOUND_BUDGET) {
                assertLe(
                    _candidateLiquidity(result.swapNative + distance, quote.sqrtPriceLimitX96, 0), result.liquidity
                );
            }
            distance <<= 1;
            if (distance > COMPOUND_BUDGET) break;
        }
    }

    function test_accountedTokenDustIsConservedAndNeverReducesLiquidity() public {
        _matureOracle();
        (, LiquidityGrowthZapPlannerV3.CompoundPlan memory withoutDust) =
            planner.plan(deepKey, address(growthVault), 12, COMPOUND_BUDGET, 0);
        uint256 accountedTokenDust = 1000 ether;
        (, LiquidityGrowthZapPlannerV3.CompoundPlan memory withDust) =
            planner.plan(deepKey, address(growthVault), 13, COMPOUND_BUDGET, accountedTokenDust);

        assertGe(withDust.liquidity, withoutDust.liquidity);
        assertEq(withDust.expectedTokenOut + accountedTokenDust, withDust.tokenForLiquidity + withDust.tokenDust);
    }

    function test_simulationMatchesRealPoolManagerSwapWithoutProtocolFee() public {
        _matureOracle();
        _assertSimulationMatchesRealSwap();
    }

    function test_simulationMatchesRealPoolManagerSwapAtMaximumDirectionalProtocolFee() public {
        _matureOracle();
        vm.prank(feeController);
        manager.setProtocolFee(deepKey, ProtocolFeeLibrary.MAX_PROTOCOL_FEE);
        _assertSimulationMatchesRealSwap();
    }

    function test_rejectsInsufficientOracleCardinalityTarget() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthZapPlannerV3.CardinalityTargetTooSmall.selector,
                1,
                Policy.MIN_OBSERVATION_CARDINALITY_NEXT
            )
        );
        planner.plan(deepKey, address(growthVault), 0, COMPOUND_BUDGET, 0);
    }

    function test_rejectsWrongVaultAndOutOfPolicyBudget() public {
        uint256 invalidBudget = Policy.MIN_COMPOUND_NATIVE - 1;
        vm.expectRevert(abi.encodeWithSelector(LiquidityGrowthZapPlannerV3.BudgetOutsidePolicy.selector, invalidBudget));
        planner.plan(deepKey, address(growthVault), 0, invalidBudget, 0);

        address wrongVault = makeAddr("wrongDeepVault");
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthZapPlannerV3.PoolBindingMismatch.selector, poolId, address(growthVault), wrongVault
            )
        );
        planner.plan(deepKey, wrongVault, 0, COMPOUND_BUDGET, 0);
    }

    function test_mathCrossesInitialBoundaryAtMostOnce() public view {
        uint128 activeLiquidity = 1_000_000_000_000_000_000_000;
        int128 initialNet = -int128(500_000_000_000_000_000_000);
        LiquidityGrowthSwapMathV3.Result memory result = mathHarness.simulate(
            LiquidityGrowthSwapMathV3.State({
                sqrtPriceX96: TickMath.getSqrtPriceAtTick(Policy.INITIAL_TICK),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(
                    Policy.INITIAL_TICK - Policy.MAX_INTERNAL_SWAP_IMPACT_TICKS
                ),
                tick: Policy.INITIAL_TICK,
                liquidity: activeLiquidity,
                initialTickLiquidityNet: initialNet,
                protocolFeePips: 0
            }),
            1_000_000_000_000
        );

        assertTrue(result.fullFill);
        assertTrue(result.crossedInitialTick);
        assertEq(result.liquidity, activeLiquidity + uint128(-initialNet));
        assertLt(result.tick, Policy.INITIAL_TICK);
    }

    function test_mathStopsAtStrictPriceLimitInsteadOfOverfilling() public view {
        uint160 current = TickMath.getSqrtPriceAtTick(0);
        uint160 limit = TickMath.getSqrtPriceAtTick(-1);
        LiquidityGrowthSwapMathV3.Result memory result = mathHarness.simulate(
            LiquidityGrowthSwapMathV3.State({
                sqrtPriceX96: current,
                sqrtPriceLimitX96: limit,
                tick: 0,
                liquidity: 1 ether,
                initialTickLiquidityNet: -int128(1),
                protocolFeePips: 0
            }),
            1 ether
        );

        assertFalse(result.fullFill);
        assertEq(result.sqrtPriceX96, limit);
        assertLt(result.amountInConsumed, 1 ether);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        assertEq(msg.sender, address(manager));
        uint8 action = abi.decode(data, (uint8));
        if (action == 1) {
            (, uint256 nativeAmount) = abi.decode(data, (uint8, uint256));
            BalanceDelta launchDelta = manager.swap(
                deepKey,
                SwapParams({
                    zeroForOne: true,
                    amountSpecified: -int256(nativeAmount),
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                abi.encode(hook.LAUNCH_BUY_DOMAIN_TAG())
            );
            NATIVE.settle(manager, address(this), nativeAmount, false);
            deepKey.currency1.take(manager, address(this), uint256(int256(launchDelta.amount1())), false);
            return "";
        }
        revert("unexpected unlock action");
    }

    function _assertSimulationMatchesRealSwap() private {
        (LiquidityGrowthZapPlannerV3.OracleQuote memory quote, LiquidityGrowthZapPlannerV3.CompoundPlan memory plan_) =
            planner.plan(deepKey, address(growthVault), 9, COMPOUND_BUDGET, 0);
        (uint160 sqrtPriceX96, int24 tick, uint24 packedProtocolFee,) = manager.getSlot0(PoolId.wrap(poolId));
        uint128 activeLiquidity = manager.getLiquidity(PoolId.wrap(poolId));
        (, int128 initialNet) = manager.getTickLiquidity(PoolId.wrap(poolId), Policy.INITIAL_TICK);
        LiquidityGrowthSwapMathV3.Result memory simulated = mathHarness.simulate(
            LiquidityGrowthSwapMathV3.State({
                sqrtPriceX96: sqrtPriceX96,
                sqrtPriceLimitX96: quote.sqrtPriceLimitX96,
                tick: tick,
                liquidity: activeLiquidity,
                initialTickLiquidityNet: initialNet,
                protocolFeePips: packedProtocolFee.getZeroForOneFee()
            }),
            plan_.swapNative
        );
        uint256 totalFeesBefore = hook.totalNativeFeesAccrued();
        bytes32 digest = keccak256("deep-planner-differential");
        vm.deal(address(growthVault), 1 ether);
        growthVault.executeInternalSwap(hook, poolId, deepKey, plan_.swapNative, quote.sqrtPriceLimitX96, digest);

        BalanceDelta actual = BalanceDelta.wrap(growthVault.lastDelta());
        assertTrue(simulated.fullFill);
        assertEq(uint256(-int256(actual.amount0())), plan_.swapNative);
        assertEq(uint256(int256(actual.amount1())), simulated.amountOut);
        (uint160 postSqrtPriceX96, int24 postTick,,) = manager.getSlot0(PoolId.wrap(poolId));
        assertEq(postSqrtPriceX96, simulated.sqrtPriceX96);
        assertEq(postTick, simulated.tick);
        assertEq(hook.totalNativeFeesAccrued(), totalFeesBefore);
        (uint8 intentState, bytes32 storedDigest) = hook.compoundIntentState(poolId);
        assertEq(intentState, Policy.INTENT_SWAPPED);
        assertEq(storedDigest, digest);
    }

    function _matureOracle() private {
        hook.increaseObservationCardinalityNext(Policy.MIN_OBSERVATION_CARDINALITY_NEXT, PoolId.wrap(poolId));
        vm.warp(block.timestamp + Policy.TWAP_WINDOW);
        uint256 grossNativeInput = 0.000_001 ether;
        swapRouter.swap{ value: grossNativeInput }(
            deepKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(grossNativeInput),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function _candidateLiquidity(uint256 swapNative, uint160 sqrtPriceLimitX96, uint256 accountedTokenDust)
        private
        view
        returns (uint128 fittedLiquidity)
    {
        (uint160 sqrtPriceX96, int24 tick, uint24 packedProtocolFee,) = manager.getSlot0(PoolId.wrap(poolId));
        (, int128 initialNet) = manager.getTickLiquidity(PoolId.wrap(poolId), Policy.INITIAL_TICK);
        LiquidityGrowthSwapMathV3.Result memory simulation = mathHarness.simulate(
            LiquidityGrowthSwapMathV3.State({
                sqrtPriceX96: sqrtPriceX96,
                sqrtPriceLimitX96: sqrtPriceLimitX96,
                tick: tick,
                liquidity: manager.getLiquidity(PoolId.wrap(poolId)),
                initialTickLiquidityNet: initialNet,
                protocolFeePips: packedProtocolFee.getZeroForOneFee()
            }),
            swapNative
        );
        if (!simulation.fullFill) return 0;
        return _fitCandidateLiquidity(simulation, swapNative, accountedTokenDust);
    }

    function _fitCandidateLiquidity(
        LiquidityGrowthSwapMathV3.Result memory simulation,
        uint256 swapNative,
        uint256 accountedTokenDust
    ) private pure returns (uint128 fittedLiquidity) {
        uint160 lower = TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_LOWER);
        uint160 upper = TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_UPPER);
        uint256 availableToken = simulation.amountOut + accountedTokenDust;
        uint128 nativeLiquidity =
            LiquidityAmounts.getLiquidityForAmount0(simulation.sqrtPriceX96, upper, COMPOUND_BUDGET - swapNative);
        uint128 tokenLiquidity = LiquidityAmounts.getLiquidityForAmount1(lower, simulation.sqrtPriceX96, availableToken);
        fittedLiquidity = nativeLiquidity < tokenLiquidity ? nativeLiquidity : tokenLiquidity;
        if (fittedLiquidity == 0) return 0;

        uint256 nativeAmount = SqrtPriceMath.getAmount0Delta(simulation.sqrtPriceX96, upper, fittedLiquidity, true);
        uint256 tokenAmount = SqrtPriceMath.getAmount1Delta(lower, simulation.sqrtPriceX96, fittedLiquidity, true);
        if (swapNative + nativeAmount > COMPOUND_BUDGET || tokenAmount > availableToken) {
            --fittedLiquidity;
        }
    }

    function _deployHook() private returns (LiquidityGrowthFeeOracleHookV2 deployed) {
        bytes memory constructorArgs = abi.encode(
            manager,
            treasury,
            ILiquidityGrowthFullRangeVaultFactoryV3(address(vaultFactory)),
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV2).creationCode,
            constructorArgs
        );
        deployed = hookFactory.deploy(
            salt,
            manager,
            treasury,
            vaultFactory,
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
    }
}
