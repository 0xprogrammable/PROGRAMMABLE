// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthVaultFactoryV1 } from "../src/LiquidityGrowthVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "../src/LiquidityGrowthVaultV1.sol";
import { ILiquidityGrowthOracleV1 } from "../src/interfaces/ILiquidityGrowthOracleV1.sol";

contract LiquidityGrowthForkToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Liquidity Growth Fork", "GROWF", 18) {
        creator = creator_;
    }
}

contract LiquidityGrowthVaultMainnetForkTest is Test {
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;

    uint256 internal constant SNAPSHOT_BLOCK = 25_612_664;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    uint16 internal constant TOTAL_SWAP_FEE_BPS = 100;
    uint256 internal constant GROWTH_TARGET = 0.004 ether;
    uint256 internal constant TOKEN_RESERVE = 10_000 ether;
    int24 internal constant RANGE_HALF_WIDTH = 10_000;
    int24 internal constant MAX_ABS_TICK_DELTA = 5;
    int24 internal constant MAX_SPOT_TWAP_DEVIATION = 400;
    uint32 internal constant TWAP_WINDOW = 5 minutes;
    uint256 internal constant OBSERVATION_SEED_BUY = 0.000_001 ether;

    IPoolManager internal poolManager;
    PoolModifyLiquidityTest internal liquidityRouter;
    PoolSwapTest internal swapRouter;
    LiquidityGrowthFeeOracleHookV1 internal hook;
    LiquidityGrowthVaultV1 internal vault;
    LiquidityGrowthRangeSourceV1 internal rangeSource;
    LiquidityGrowthForkToken internal token;
    PoolKey internal key;
    bytes32 internal poolId;
    address internal beneficiary;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    receive() external payable { }

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(address(this), 10_000 ether);

        poolManager = IPoolManager(POOL_MANAGER);
        liquidityRouter = new PoolModifyLiquidityTest(poolManager);
        swapRouter = new PoolSwapTest(poolManager);
        FeeSplitVaultFactoryV1 splitFactory = new FeeSplitVaultFactoryV1();
        LiquidityGrowthVaultFactoryV1 growthFactory = new LiquidityGrowthVaultFactoryV1();
        LiquidityGrowthFeeOracleHookFactoryV1 hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        address treasury = makeAddr("liquidityGrowthForkTreasury");
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(poolManager, treasury, splitFactory, MAX_ABS_TICK_DELTA)
        );
        hook = hookFactory.deploy(hookSalt, poolManager, treasury, splitFactory, MAX_ABS_TICK_DELTA);

        token = new LiquidityGrowthForkToken(address(this));
        token.mint(address(this), 2_000_000 ether);
        token.approve(address(liquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        poolId = PoolId.unwrap(key.toId());
        rangeSource = new LiquidityGrowthRangeSourceV1(
            poolManager,
            key,
            ILiquidityGrowthOracleV1(address(hook)),
            TWAP_WINDOW,
            RANGE_HALF_WIDTH,
            MAX_SPOT_TWAP_DEVIATION
        );

        beneficiary = makeAddr("liquidityGrowthForkBeneficiary");
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = beneficiary;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        LiquidityGrowthVaultV1.Configuration memory configuration = LiquidityGrowthVaultV1.Configuration({
            poolKey: key,
            rangeSource: rangeSource,
            growthTargetNative: GROWTH_TARGET,
            maxCompoundNative: GROWTH_TARGET,
            tokenReserveTarget: TOKEN_RESERVE,
            activeRangeHalfWidthTicks: RANGE_HALF_WIDTH,
            compoundCooldownBlocks: 1,
            beneficiaries: beneficiaries,
            sharesBps: shares
        });
        vault = growthFactory.deployOrGet(keccak256("liquidity-growth-mainnet-fork"), hook, splitFactory, configuration);
        assertTrue(token.transfer(address(vault), TOKEN_RESERVE));

        hook.registerPool(key, address(vault.upstreamVault()), TOTAL_SWAP_FEE_BPS, TOTAL_SWAP_FEE_BPS);
        poolManager.initialize(key, uint160(1 << 96));
        liquidityRouter.modifyLiquidity{ value: 1000 ether }(
            key,
            ModifyLiquidityParams({
                tickLower: -20_000,
                tickUpper: 20_000,
                liquidityDelta: 1000 ether,
                salt: keccak256("fork-base-liquidity")
            }),
            ""
        );
        hook.increaseObservationCardinalityNext(2, PoolId.wrap(poolId));
        vm.warp(block.timestamp + TWAP_WINDOW);
        _swapSpecified(true, -OBSERVATION_SEED_BUY.toInt256(), OBSERVATION_SEED_BUY);
    }

    function test_officialMainnetPoolManagerSupportsExactOutputGrowthLifecycleAndLockedPosition() public {
        BalanceDelta buy = _swap(true, 0.5 ether, 2 ether);
        assertEq(uint256(int256(buy.amount1())), 0.5 ether);
        uint256 creatorAfterBuy = _creatorAccrued();
        assertGt(creatorAfterBuy, 0);

        BalanceDelta sell = _swap(false, 0.1 ether, 0);
        assertEq(uint256(int256(sell.amount0())), 0.1 ether);
        uint256 creatorAfterSell = _creatorAccrued();
        assertGt(creatorAfterSell, creatorAfterBuy);

        LiquidityGrowthRangeSourceV1.RangeQuote memory quote = rangeSource.quoteRange();
        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory result) = vault.process();
        assertEq(received, creatorAfterSell);
        assertGt(result.liquidityAdded, 0);
        assertEq(result.tickLower, quote.tickLower);
        assertEq(result.tickUpper, quote.tickUpper);
        assertEq(_creatorAccrued(), 0);
        assertEq(vault.lockedLiquidityAt(result.tickLower, result.tickUpper), result.liquidityAdded);

        (uint128 officialPositionLiquidity,,) = poolManager.getPositionInfo(
            key.toId(), address(vault), result.tickLower, result.tickUpper, vault.LOCKED_POSITION_SALT()
        );
        assertEq(officialPositionLiquidity, result.liquidityAdded);
        assertEq(vault.lastLockedTickLower(), result.tickLower);
        assertEq(vault.lastLockedTickUpper(), result.tickUpper);
        assertEq(
            vault.totalNativeAddedToLiquidity() + vault.pendingGrowthNative(),
            vault.totalNativeAllocatedToGrowth() + vault.totalNativeRecycled()
        );
        assertEq(
            token.balanceOf(address(vault)) + vault.totalTokenAddedToLiquidity(),
            TOKEN_RESERVE + vault.totalTokenRecycled()
        );
    }

    function _swap(bool zeroForOne, uint256 exactOutput, uint256 value) private returns (BalanceDelta) {
        return _swapSpecified(zeroForOne, exactOutput.toInt256(), value);
    }

    function _swapSpecified(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta) {
        return swapRouter.swap{ value: value }(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function _creatorAccrued() private view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(poolId);
    }
}
