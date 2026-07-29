// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
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

import { LiquidityGrowthFeeOracleHookFactoryV2 } from "../../src/LiquidityGrowthFeeOracleHookFactoryV2.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "../../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultFactoryV3 } from "../../src/LiquidityGrowthFullRangeVaultFactoryV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../../src/LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthZapPlannerV3 } from "../../src/LiquidityGrowthZapPlannerV3.sol";
import {
    ILiquidityGrowthFeeOracleHookV2,
    ILiquidityGrowthFullRangeVaultFactoryV3
} from "../../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

contract DeepV3FixtureToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Deep V3 Fixture", "D3FIX", 18) {
        creator = creator_;
    }
}

/// @notice Shared real-PoolManager fixture for Deep V3 atomic vault, security and invariant tests.
abstract contract LiquidityGrowthFullRangeV3Fixture is Deployers, IUnlockCallback {
    using CurrencySettler for Currency;

    bytes32 internal constant INITIAL_POSITION_SALT = bytes32(uint256(1));
    Currency internal constant NATIVE = Currency.wrap(address(0));

    LiquidityGrowthFeeOracleHookFactoryV2 internal v3HookFactory;
    LiquidityGrowthFeeOracleHookV2 internal v3Hook;
    LiquidityGrowthFullRangeVaultFactoryV3 internal v3VaultFactory;
    LiquidityGrowthFullRangeVaultV3 internal v3Vault;
    LiquidityGrowthZapPlannerV3 internal v3Planner;
    DeepV3FixtureToken internal v3Token;
    PoolKey internal v3Key;
    bytes32 internal v3PoolId;
    address internal v3Treasury;
    uint256 internal v3InitialTokenDust;

    PoolSwapTest.TestSettings internal v3SwapSettings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public virtual {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        v3Treasury = makeAddr("deepV3Treasury");
        v3Planner = new LiquidityGrowthZapPlannerV3();
        v3VaultFactory = new LiquidityGrowthFullRangeVaultFactoryV3(v3Planner);
        v3HookFactory = new LiquidityGrowthFeeOracleHookFactoryV2();
        v3Hook = _deployV3Hook();
        v3Token = new DeepV3FixtureToken(address(this));
        v3Token.mint(address(this), Policy.TOKEN_SUPPLY);

        v3Key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(v3Token)),
            fee: Policy.LP_FEE_PIPS,
            tickSpacing: Policy.TICK_SPACING,
            hooks: v3Hook
        });
        v3PoolId = PoolId.unwrap(v3Key.toId());
        uint160 initialLowerSqrtPriceX96 = TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_LOWER);
        uint160 initialSqrtPriceX96 = Policy.initialSqrtPriceX96();
        uint128 initialLiquidity = LiquidityAmounts.getLiquidityForAmount1(
            initialLowerSqrtPriceX96, initialSqrtPriceX96, Policy.TOKEN_SUPPLY
        );
        uint256 initialTokenLiquidity =
            SqrtPriceMath.getAmount1Delta(initialLowerSqrtPriceX96, initialSqrtPriceX96, initialLiquidity, true);
        v3InitialTokenDust = Policy.TOKEN_SUPPLY - initialTokenLiquidity;
        v3Vault = v3VaultFactory.deploy(
            keccak256("programmable.deep.v3.fixture.vault"),
            ILiquidityGrowthFeeOracleHookV2(address(v3Hook)),
            v3Key,
            v3InitialTokenDust
        );

        assertEq(v3Hook.registerPool(v3Key, address(v3Vault)), v3PoolId);
        assertEq(manager.initialize(v3Key, Policy.initialSqrtPriceX96()), Policy.INITIAL_TICK);

        v3Token.approve(address(modifyLiquidityRouter), type(uint256).max);
        v3Token.approve(address(swapRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity(
            v3Key,
            ModifyLiquidityParams({
                tickLower: Policy.FULL_RANGE_TICK_LOWER,
                tickUpper: Policy.INITIAL_TICK,
                liquidityDelta: int256(uint256(initialLiquidity)),
                salt: INITIAL_POSITION_SALT
            }),
            abi.encode(v3Hook.BOOTSTRAP_DOMAIN_TAG())
        );
        assertTrue(v3Token.transfer(address(v3Vault), v3InitialTokenDust));

        manager.unlock(abi.encode(uint8(1), _initialBuy()));
        v3Hook.finalizePool(v3Key);
    }

    function _initialBuy() internal pure virtual returns (uint256) {
        return 1 ether;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        assertEq(msg.sender, address(manager));
        (uint8 action, uint256 nativeAmount) = abi.decode(data, (uint8, uint256));
        assertEq(action, 1);
        BalanceDelta launchDelta = manager.swap(
            v3Key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(nativeAmount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            abi.encode(v3Hook.LAUNCH_BUY_DOMAIN_TAG())
        );
        assertEq(uint256(-int256(launchDelta.amount0())), nativeAmount);
        NATIVE.settle(manager, address(this), nativeAmount, false);
        v3Key.currency1.take(manager, address(this), uint256(int256(launchDelta.amount1())), false);
        return "";
    }

    function _matureV3Oracle() internal {
        v3Hook.increaseObservationCardinalityNext(Policy.MIN_OBSERVATION_CARDINALITY_NEXT, PoolId.wrap(v3PoolId));
        vm.warp(block.timestamp + Policy.TWAP_WINDOW);
        vm.roll(block.number + 150);
        _ordinaryV3Buy(0.000_001 ether);
    }

    function _ordinaryV3Buy(uint256 nativeAmount) internal returns (BalanceDelta delta) {
        delta = swapRouter.swap{ value: nativeAmount }(
            v3Key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(nativeAmount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            v3SwapSettings,
            ""
        );
    }

    function _growthFeesAccrued() internal view returns (uint256 growthFees) {
        (,,, growthFees) = v3Hook.poolFeeConfig(v3PoolId);
    }

    function _deployV3Hook() private returns (LiquidityGrowthFeeOracleHookV2 deployed) {
        bytes memory constructorArgs = abi.encode(
            manager,
            v3Treasury,
            ILiquidityGrowthFullRangeVaultFactoryV3(address(v3VaultFactory)),
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
        (, bytes32 salt) = HookMiner.find(
            address(v3HookFactory),
            v3HookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV2).creationCode,
            constructorArgs
        );
        deployed = v3HookFactory.deploy(
            salt,
            manager,
            v3Treasury,
            ILiquidityGrowthFullRangeVaultFactoryV3(address(v3VaultFactory)),
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
    }
}
