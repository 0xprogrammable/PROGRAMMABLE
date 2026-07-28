// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { Oracle } from "@openzeppelin/uniswap-hooks/src/oracles/panoptic/libraries/Oracle.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthCreatorFeeHookFactoryV3 } from "../src/EthCreatorFeeHookFactoryV3.sol";
import { EthCreatorFeeHookV3 } from "../src/EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";
import { ILiquidityGrowthOracleV1 } from "../src/interfaces/ILiquidityGrowthOracleV1.sol";

contract LiquidityGrowthOracleCreatorTokenV1 is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Liquidity Growth Oracle", "LGO", 18) {
        creator = creator_;
    }
}

contract LiquidityGrowthFeeOracleHookV1Test is Deployers {
    using StateLibrary for IPoolManager;

    uint16 internal constant BUY_FEE_BPS = 200;
    uint16 internal constant SELL_FEE_BPS = 700;
    uint256 internal constant BASIS_POINTS = 10_000;
    int24 internal constant MAX_ABS_TICK_DELTA = 5;

    LiquidityGrowthFeeOracleHookFactoryV1 internal hookFactory;
    EthCreatorFeeHookFactoryV3 internal classicHookFactory;
    FeeSplitVaultFactoryV1 internal vaultFactory;
    LiquidityGrowthFeeOracleHookV1 internal hook;
    EthCreatorFeeHookV3 internal classicHook;
    FeeSplitVaultV1 internal vault;
    LiquidityGrowthOracleCreatorTokenV1 internal token;
    LiquidityGrowthOracleCreatorTokenV1 internal classicToken;
    PoolKey internal hookKey;
    PoolKey internal classicKey;
    bytes32 internal poolId;
    bytes32 internal classicPoolId;
    bytes32 internal hookSalt;

    address internal treasury;
    address internal beneficiary;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        treasury = makeAddr("programmableTreasury");
        beneficiary = makeAddr("beneficiary");
        vaultFactory = new FeeSplitVaultFactoryV1();
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        classicHookFactory = new EthCreatorFeeHookFactoryV3();
        hook = _deployHook(MAX_ABS_TICK_DELTA);
        classicHook = _deployClassicHook();

        token = new LiquidityGrowthOracleCreatorTokenV1(address(this));
        classicToken = new LiquidityGrowthOracleCreatorTokenV1(address(this));
        token.mint(address(this), 1_000_000 ether);
        classicToken.mint(address(this), 1_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);
        classicToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        classicToken.approve(address(swapRouter), type(uint256).max);

        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        poolId = PoolId.unwrap(hookKey.toId());
        classicKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(classicToken)),
            fee: classicHook.LP_FEE_PIPS(),
            tickSpacing: classicHook.TICK_SPACING(),
            hooks: classicHook
        });
        classicPoolId = PoolId.unwrap(classicKey.toId());
        vault = vaultFactory.deploy(
            bytes32("growth-oracle-vault"),
            IClassicFeeHookV3(address(hook)),
            poolId,
            _addresses1(beneficiary),
            _shares1(10_000)
        );
        FeeSplitVaultV1 classicVault = vaultFactory.deploy(
            bytes32("classic-parity-vault"),
            IClassicFeeHookV3(address(classicHook)),
            classicPoolId,
            _addresses1(beneficiary),
            _shares1(10_000)
        );
        hook.registerPool(hookKey, address(vault), BUY_FEE_BPS, SELL_FEE_BPS);
        classicHook.registerPool(classicKey, address(classicVault), BUY_FEE_BPS, SELL_FEE_BPS);
        manager.initialize(hookKey, SQRT_PRICE_1_1);
        manager.initialize(classicKey, SQRT_PRICE_1_1);

        ModifyLiquidityParams memory parameters =
            ModifyLiquidityParams({ tickLower: -2000, tickUpper: 2000, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 200 ether }(hookKey, parameters, ZERO_BYTES);
        modifyLiquidityRouter.modifyLiquidity{ value: 200 ether }(classicKey, parameters, ZERO_BYTES);
    }

    function test_factoryPermissionsAndConfigurationCommitmentAreExact() public view {
        uint160 expectedFlags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        assertEq(hookFactory.REQUIRED_HOOK_FLAGS(), expectedFlags);
        assertEq(uint160(address(hook)) & hookFactory.ALL_HOOK_MASK(), expectedFlags);
        assertTrue(hookFactory.isFactoryHook(address(hook)));
        assertEq(hook.maxAbsTickDelta(), MAX_ABS_TICK_DELTA);

        bytes32 expectedConfigurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(hookFactory),
                address(hook),
                address(manager),
                treasury,
                address(vaultFactory),
                MAX_ABS_TICK_DELTA
            )
        );
        assertEq(hookFactory.configurationHashOf(address(hook)), expectedConfigurationHash);
        assertEq(hookFactory.predict(hookSalt, manager, treasury, vaultFactory, MAX_ABS_TICK_DELTA), address(hook));
        assertNotEq(
            hookFactory.predict(hookSalt, manager, treasury, vaultFactory, MAX_ABS_TICK_DELTA + 1), address(hook)
        );
    }

    function test_hookPermissionsAddOnlyAfterInitializeToClassicFeeCallbacks() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.afterInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
    }

    function test_afterInitializeCreatesTheBaselineObservation() public view {
        (uint16 index, uint16 cardinality, uint16 cardinalityNext) = hook.stateById(PoolId.wrap(poolId));
        (uint32 timestamp, int24 previousTruncatedTick, int56 cumulative, int56 truncatedCumulative, bool initialized) =
            hook.observationsById(PoolId.wrap(poolId), 0);

        assertEq(index, 0);
        assertEq(cardinality, 1);
        assertEq(cardinalityNext, 1);
        assertEq(timestamp, uint32(block.timestamp));
        assertEq(previousTruncatedTick, 0);
        assertEq(cumulative, 0);
        assertEq(truncatedCumulative, 0);
        assertTrue(initialized);
    }

    function test_preSwapObservationTruncatesOneStepAndFeedsRangeSource() public {
        hook.increaseObservationCardinalityNext(192, PoolId.wrap(poolId));
        vm.warp(block.timestamp + 10 minutes);
        _swap(true, -int256(1 ether), 1 ether);

        (, int24 spotTick,,) = manager.getSlot0(PoolId.wrap(poolId));
        assertLt(spotTick, -MAX_ABS_TICK_DELTA);

        vm.warp(block.timestamp + 30 minutes);
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = 30 minutes;
        secondsAgos[1] = 0;
        (int56[] memory raw, int56[] memory truncated) = hook.observe(secondsAgos, PoolId.wrap(poolId));

        int56 rawMean = (raw[1] - raw[0]) / int56(uint56(30 minutes));
        int56 truncatedMean = (truncated[1] - truncated[0]) / int56(uint56(30 minutes));
        assertEq(rawMean, spotTick);
        assertEq(truncatedMean, -MAX_ABS_TICK_DELTA);

        LiquidityGrowthRangeSourceV1 source = new LiquidityGrowthRangeSourceV1(
            manager, hookKey, ILiquidityGrowthOracleV1(address(hook)), 30 minutes, 2000, 1000
        );
        LiquidityGrowthRangeSourceV1.RangeQuote memory quote = source.quoteRange();
        assertEq(quote.twapTick, -MAX_ABS_TICK_DELTA);
        assertEq(quote.spotTick, spotTick);
    }

    function test_observeFailsClosedBeforeRequestedHistoryExists() public {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = 30 minutes;
        secondsAgos[1] = 0;

        uint32 targetTimestamp;
        unchecked {
            targetTimestamp = uint32(block.timestamp) - secondsAgos[0];
        }
        vm.expectRevert(
            abi.encodeWithSelector(
                Oracle.TargetPredatesOldestObservation.selector, uint32(block.timestamp), targetTimestamp
            )
        );
        hook.observe(secondsAgos, PoolId.wrap(poolId));
    }

    function test_cardinalityGrowthIsPermissionlessAndWritesAtMostOncePerBlock() public {
        address keeper = makeAddr("oracleKeeper");
        vm.prank(keeper);
        hook.increaseObservationCardinalityNext(3, PoolId.wrap(poolId));

        (uint16 initialIndex, uint16 initialCardinality, uint16 cardinalityNext) = hook.stateById(PoolId.wrap(poolId));
        assertEq(initialIndex, 0);
        assertEq(initialCardinality, 1);
        assertEq(cardinalityNext, 3);

        vm.warp(block.timestamp + 1 minutes);
        _swap(true, -int256(0.01 ether), 0.01 ether);
        _swap(false, -int256(0.005 ether), 0);

        (uint16 firstIndex, uint16 firstCardinality, uint16 firstCardinalityNext) = hook.stateById(PoolId.wrap(poolId));
        assertEq(firstIndex, 1);
        assertEq(firstCardinality, 3);
        assertEq(firstCardinalityNext, 3);

        vm.warp(block.timestamp + 1);
        _swap(true, -int256(0.01 ether), 0.01 ether);

        (uint16 secondIndex, uint16 secondCardinality, uint16 secondCardinalityNext) =
            hook.stateById(PoolId.wrap(poolId));
        assertEq(secondIndex, 2);
        assertEq(secondCardinality, 3);
        assertEq(secondCardinalityNext, 3);
    }

    function test_exactInputBuyMatchesEthCreatorFeeHookV3() public {
        _assertExactParity(true, -int256(0.1 ether), 0.1 ether);
    }

    function test_exactOutputBuyMatchesEthCreatorFeeHookV3() public {
        _assertExactParity(true, int256(0.01 ether), 1 ether);
    }

    function test_exactInputSellMatchesEthCreatorFeeHookV3() public {
        _assertExactParity(false, -int256(0.01 ether), 0);
    }

    function test_exactOutputSellMatchesEthCreatorFeeHookV3() public {
        _assertExactParity(false, int256(0.005 ether), 0);
    }

    function test_buyExactInputKeepsClassicFeeAccounting() public {
        uint256 gross = 0.1 ether;
        BalanceDelta delta = _swap(true, -int256(gross), gross);
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteGrossFees(gross, BUY_FEE_BPS);

        assertEq(uint256(-int256(delta.amount0())), gross);
        _assertAccrued(creatorFee, launcherFee);
    }

    function test_buyExactOutputKeepsClassicFeeAccounting() public {
        uint256 tokenOutput = 0.01 ether;
        BalanceDelta delta = _swap(true, int256(tokenOutput), 1 ether);
        uint256 creatorFee = _creatorAccrued();
        uint256 launcherFee = hook.launcherFeesAccrued();
        uint256 grossNativeInput = uint256(-int256(delta.amount0()));
        uint256 netNativeInput = grossNativeInput - creatorFee - launcherFee;
        (uint256 expectedCreator, uint256 expectedLauncher) = hook.quoteExactOutputFees(netNativeInput, BUY_FEE_BPS);

        assertEq(uint256(int256(delta.amount1())), tokenOutput);
        _assertAccrued(expectedCreator, expectedLauncher);
    }

    function test_sellExactInputKeepsClassicFeeAccounting() public {
        uint256 tokenInput = 0.01 ether;
        BalanceDelta delta = _swap(false, -int256(tokenInput), 0);
        uint256 creatorFee = _creatorAccrued();
        uint256 launcherFee = hook.launcherFeesAccrued();
        uint256 grossNativeOutput = uint256(int256(delta.amount0())) + creatorFee + launcherFee;
        (uint256 expectedCreator, uint256 expectedLauncher) = hook.quoteGrossFees(grossNativeOutput, SELL_FEE_BPS);

        assertEq(uint256(-int256(delta.amount1())), tokenInput);
        _assertAccrued(expectedCreator, expectedLauncher);
    }

    function test_sellExactOutputKeepsClassicFeeAccounting() public {
        uint256 netNativeOutput = 0.005 ether;
        BalanceDelta delta = _swap(false, int256(netNativeOutput), 0);
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteExactOutputFees(netNativeOutput, SELL_FEE_BPS);

        assertEq(uint256(int256(delta.amount0())), netNativeOutput);
        _assertAccrued(creatorFee, launcherFee);
    }

    function test_onlyPoolManagerCanCallEveryEnabledCallback() public {
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), hookKey, SQRT_PRICE_1_1);

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterInitialize(address(this), hookKey, SQRT_PRICE_1_1, 0);

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), hookKey, params, "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), hookKey, params, BalanceDelta.wrap(0), "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback("");
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_feeQuotesMatchClassicEconomics(uint96 rawGross, uint8 rawPercent) public view {
        uint256 gross = bound(uint256(rawGross), 10_000, 100_000 ether);
        uint16 totalFeeBps = uint16(bound(uint256(rawPercent), 1, 10) * 100);
        (uint256 creatorFee, uint256 launcherFee) = hook.quoteGrossFees(gross, totalFeeBps);
        assertEq(creatorFee + launcherFee, FullMath.mulDiv(gross, totalFeeBps, BASIS_POINTS));
        assertEq(launcherFee, FullMath.mulDiv(gross, 10, BASIS_POINTS));
    }

    function _deployHook(int24 maxAbsTickDelta) private returns (LiquidityGrowthFeeOracleHookV1 deployed) {
        (, hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, treasury, vaultFactory, maxAbsTickDelta)
        );
        deployed = hookFactory.deploy(hookSalt, manager, treasury, vaultFactory, maxAbsTickDelta);
    }

    function _deployClassicHook() private returns (EthCreatorFeeHookV3 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(classicHookFactory),
            classicHookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV3).creationCode,
            abi.encode(manager, treasury, vaultFactory)
        );
        deployed = classicHookFactory.deploy(salt, manager, treasury, vaultFactory);
    }

    function _swap(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta) {
        return swapRouter.swap{ value: value }(
            hookKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _classicSwap(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta) {
        return swapRouter.swap{ value: value }(
            classicKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _assertExactParity(bool zeroForOne, int256 amountSpecified, uint256 value) private {
        BalanceDelta oracleDelta = _swap(zeroForOne, amountSpecified, value);
        BalanceDelta classicDelta = _classicSwap(zeroForOne, amountSpecified, value);

        assertEq(BalanceDelta.unwrap(oracleDelta), BalanceDelta.unwrap(classicDelta));
        assertEq(_creatorAccrued(), _classicCreatorAccrued());
        assertEq(hook.launcherFeesAccrued(), classicHook.launcherFeesAccrued());
        assertEq(hook.totalNativeFeesAccrued(), classicHook.totalNativeFeesAccrued());
        assertEq(
            manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()),
            manager.balanceOf(address(classicHook), CurrencyLibrary.ADDRESS_ZERO.toId())
        );
    }

    function _creatorAccrued() private view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(poolId);
    }

    function _classicCreatorAccrued() private view returns (uint256 accrued) {
        (,,,,, accrued) = classicHook.poolFeeConfig(classicPoolId);
    }

    function _assertAccrued(uint256 creatorFee, uint256 launcherFee) private view {
        assertEq(_creatorAccrued(), creatorFee);
        assertEq(hook.launcherFeesAccrued(), launcherFee);
        assertEq(hook.totalNativeFeesAccrued(), creatorFee + launcherFee);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), creatorFee + launcherFee);
    }

    function _addresses1(address value) private pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = value;
    }

    function _shares1(uint16 value) private pure returns (uint16[] memory values) {
        values = new uint16[](1);
        values[0] = value;
    }
}
