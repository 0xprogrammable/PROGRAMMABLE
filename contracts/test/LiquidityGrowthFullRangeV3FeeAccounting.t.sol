// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { LiquidityGrowthFeeOracleHookFactoryV2 } from "../src/LiquidityGrowthFeeOracleHookFactoryV2.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { ILiquidityGrowthFullRangeVaultFactoryV3 } from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

contract DeepV3FeeMockVaultFactory is ILiquidityGrowthFullRangeVaultFactoryV3 {
    mapping(address vault => bytes32 configurationHash) public configurationHashOf;
    mapping(address vault => bytes32 bindingHash) public vaultBindingHash;

    function register(address vault, address hook, bytes32 poolId, address token) external {
        configurationHashOf[vault] = keccak256(abi.encode(block.chainid, address(this), vault));
        vaultBindingHash[vault] = keccak256(abi.encode(block.chainid, address(this), vault, hook, poolId, token));
    }
}

contract DeepV3FeeMockVault { }

contract DeepV3FeeCreatorToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Deep V3 Fee Token", "D3F", 18) {
        creator = creator_;
    }
}

contract LiquidityGrowthFullRangeV3FeeAccountingTest is Deployers, IUnlockCallback {
    using CurrencySettler for Currency;

    uint256 private constant INITIAL_BUY = 0.01 ether;
    Currency private constant NATIVE = Currency.wrap(address(0));

    LiquidityGrowthFeeOracleHookFactoryV2 private hookFactory;
    LiquidityGrowthFeeOracleHookV2 private hook;
    DeepV3FeeMockVaultFactory private vaultFactory;
    DeepV3FeeMockVault private growthVault;
    DeepV3FeeCreatorToken private token;
    PoolKey private deepKey;
    bytes32 private poolId;
    address private treasury;

    PoolSwapTest.TestSettings private settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        treasury = makeAddr("deepV3Treasury");
        vaultFactory = new DeepV3FeeMockVaultFactory();
        growthVault = new DeepV3FeeMockVault();
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV2();
        hook = _deployHook();

        token = new DeepV3FeeCreatorToken(address(this));
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
        vaultFactory.register(address(growthVault), address(hook), poolId, address(token));
        assertEq(hook.registerPool(deepKey, address(growthVault)), poolId);
        assertEq(manager.initialize(deepKey, Policy.initialSqrtPriceX96()), Policy.INITIAL_TICK);

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

        manager.unlock(abi.encode(INITIAL_BUY));
        hook.finalizePool(deepKey);
        token.approve(address(swapRouter), type(uint256).max);
    }

    function test_feeDisclosureIsFixedNativeNinetyTen() public view {
        (uint16 total, uint16 growth, uint16 programmable, uint16 transferTax, uint24 lpFee, address vault) =
            hook.feeDisclosure(poolId);

        assertEq(total, 100);
        assertEq(growth, 90);
        assertEq(programmable, 10);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(vault, address(growthVault));
    }

    function test_exactInputBuyAccruesExactNinetyTenNativeSplit() public {
        (uint256 growthBefore, uint256 programmableBefore) = _feeSnapshot();
        uint256 grossNativeInput = 0.1 ether;

        BalanceDelta delta = _swap(true, -int256(grossNativeInput), grossNativeInput);
        (uint256 growthAfter, uint256 programmableAfter) = _feeSnapshot();

        assertEq(uint256(-int256(delta.amount0())), grossNativeInput);
        _assertGrossSplit(grossNativeInput, growthAfter - growthBefore, programmableAfter - programmableBefore);
    }

    function test_exactOutputBuyAccruesExactNinetyTenNativeSplit() public {
        (uint256 growthBefore, uint256 programmableBefore) = _feeSnapshot();
        uint256 tokenOutput = 10_000 ether;

        BalanceDelta delta = _swap(true, int256(tokenOutput), 1 ether);
        (uint256 growthAfter, uint256 programmableAfter) = _feeSnapshot();
        uint256 growthIncrease = growthAfter - growthBefore;
        uint256 programmableIncrease = programmableAfter - programmableBefore;
        uint256 grossNativeInput = uint256(-int256(delta.amount0()));
        uint256 netNativeInput = grossNativeInput - growthIncrease - programmableIncrease;
        (uint256 expectedGrowth, uint256 expectedProgrammable) = hook.quoteExactOutputFees(netNativeInput);

        assertEq(uint256(int256(delta.amount1())), tokenOutput);
        assertEq(growthIncrease, expectedGrowth);
        assertEq(programmableIncrease, expectedProgrammable);
        assertEq(growthIncrease + programmableIncrease, grossNativeInput - netNativeInput);
    }

    function test_exactInputSellAccruesExactNinetyTenNativeSplit() public {
        (uint256 growthBefore, uint256 programmableBefore) = _feeSnapshot();
        uint256 tokenInput = 100_000 ether;

        BalanceDelta delta = _swap(false, -int256(tokenInput), 0);
        (uint256 growthAfter, uint256 programmableAfter) = _feeSnapshot();
        uint256 growthIncrease = growthAfter - growthBefore;
        uint256 programmableIncrease = programmableAfter - programmableBefore;
        uint256 grossNativeOutput = uint256(int256(delta.amount0())) + growthIncrease + programmableIncrease;

        assertEq(uint256(-int256(delta.amount1())), tokenInput);
        _assertGrossSplit(grossNativeOutput, growthIncrease, programmableIncrease);
    }

    function test_exactOutputSellAccruesExactNinetyTenNativeSplit() public {
        (uint256 growthBefore, uint256 programmableBefore) = _feeSnapshot();
        uint256 netNativeOutput = 0.000_01 ether;

        BalanceDelta delta = _swap(false, int256(netNativeOutput), 0);
        (uint256 growthAfter, uint256 programmableAfter) = _feeSnapshot();
        uint256 growthIncrease = growthAfter - growthBefore;
        uint256 programmableIncrease = programmableAfter - programmableBefore;
        (uint256 expectedGrowth, uint256 expectedProgrammable) = hook.quoteExactOutputFees(netNativeOutput);

        assertEq(uint256(int256(delta.amount0())), netNativeOutput);
        assertEq(growthIncrease, expectedGrowth);
        assertEq(programmableIncrease, expectedProgrammable);
    }

    function testFuzz_grossQuoteConservesEveryWei(uint128 grossNative) public view {
        (uint256 growth, uint256 programmable) = hook.quoteGrossFees(grossNative);
        uint256 total = FullMath.mulDiv(grossNative, Policy.TOTAL_HOOK_FEE_BPS, Policy.BASIS_POINTS);

        assertEq(growth + programmable, total);
        assertEq(programmable, FullMath.mulDiv(grossNative, Policy.PROGRAMMABLE_FEE_BPS, Policy.BASIS_POINTS));
    }

    function testFuzz_exactOutputQuoteConservesEveryWei(uint128 netNative) public view {
        (uint256 growth, uint256 programmable) = hook.quoteExactOutputFees(netNative);
        uint256 gross = FullMath.mulDivRoundingUp(
            netNative, Policy.BASIS_POINTS, Policy.BASIS_POINTS - Policy.TOTAL_HOOK_FEE_BPS
        );

        assertEq(growth + programmable, gross - netNative);
        assertLe(programmable, gross - netNative);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        assertEq(msg.sender, address(manager));
        uint256 nativeAmount = abi.decode(data, (uint256));
        BalanceDelta delta = manager.swap(
            deepKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(nativeAmount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            abi.encode(hook.LAUNCH_BUY_DOMAIN_TAG())
        );
        assertEq(uint256(-int256(delta.amount0())), nativeAmount);
        NATIVE.settle(manager, address(this), nativeAmount, false);
        deepKey.currency1.take(manager, address(this), uint256(int256(delta.amount1())), false);
        return "";
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
            ILiquidityGrowthFullRangeVaultFactoryV3(address(vaultFactory)),
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
    }

    function _swap(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta delta) {
        delta = swapRouter.swap{ value: value }(
            deepKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function _feeSnapshot() private view returns (uint256 growthAccrued, uint256 programmableAccrued) {
        (,,, growthAccrued) = hook.poolFeeConfig(poolId);
        programmableAccrued = hook.launcherFeesAccrued();
    }

    function _assertGrossSplit(uint256 gross, uint256 growth, uint256 programmable) private pure {
        assertEq(growth + programmable, gross * Policy.TOTAL_HOOK_FEE_BPS / Policy.BASIS_POINTS);
        assertEq(programmable, gross * Policy.PROGRAMMABLE_FEE_BPS / Policy.BASIS_POINTS);
        assertEq(growth, gross * Policy.TOTAL_HOOK_FEE_BPS / Policy.BASIS_POINTS - programmable);
    }
}
