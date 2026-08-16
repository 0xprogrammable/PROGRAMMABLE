// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ProgrammableVolumeFeeHookV1 } from "../src/ProgrammableVolumeFeeHookV1.sol";
import { ProgrammableVolumeFeeHookFactoryV1 } from "../src/ProgrammableVolumeFeeHookFactoryV1.sol";
import { MockReferenceToken } from "./MockReferenceToken.sol";

contract FeeMathInvariantHandler {
    ProgrammableVolumeFeeHookV1 public immutable hook;
    bool public conservationViolated;
    bool public platformFloorViolated;
    bool public exactOutputNetViolated;

    constructor(ProgrammableVolumeFeeHookV1 hook_) {
        hook = hook_;
    }

    function checkGross(uint96 rawGross, uint32 rawSelected) external {
        uint256 gross = 1000 + uint256(rawGross);
        uint32 selected = rawSelected % (hook.MAX_SELECTED_HUNDREDTHS_OF_BIP() + 1);
        (uint256 total, uint256 project, uint256 programmable) = hook.quoteGrossFees(gross, selected);
        if (total != project + programmable) conservationViolated = true;
        if (programmable == 0) platformFloorViolated = true;
    }

    function checkExactOutput(uint96 rawNet, uint32 rawSelected) external {
        uint256 net = 1000 + uint256(rawNet);
        uint32 selected = rawSelected % (hook.MAX_SELECTED_HUNDREDTHS_OF_BIP() + 1);
        (uint256 gross, uint256 total, uint256 project, uint256 programmable) = hook.quoteExactOutputFees(net, selected);
        if (total != project + programmable) conservationViolated = true;
        if (programmable == 0) platformFloorViolated = true;
        if (gross - total != net) exactOutputNetViolated = true;
    }
}

contract ProgrammableVolumeFeeHookV1Test is Deployers {
    using SafeCast for uint256;

    uint256 internal constant RATE_DENOMINATOR = 1_000_000;
    uint24 internal constant LP_FEE_PIPS = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint32 internal constant SELECTED_THREE_PERCENT = 30_000;

    ProgrammableVolumeFeeHookFactoryV1 internal hookFactory;
    ProgrammableVolumeFeeHookV1 internal hook;
    MockReferenceToken internal projectToken;
    FeeMathInvariantHandler internal invariantHandler;
    PoolKey internal hookKey;
    bytes32 internal poolId;

    address internal projectFeeOwner = makeAddr("projectFeeOwner");
    address internal attacker = makeAddr("attacker");
    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        hookFactory = new ProgrammableVolumeFeeHookFactoryV1();
        hook = _deployHook(address(0));
        projectToken = new MockReferenceToken("Reference Project", "RPROJ");
        projectToken.mint(address(this), 1_000_000 ether);
        projectToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        projectToken.approve(address(swapRouter), type(uint256).max);

        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(projectToken)),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
        poolId = PoolId.unwrap(hookKey.toId());
        hook.registerCanonicalPool(
            hookKey, projectFeeOwner, SELECTED_THREE_PERCENT, SELECTED_THREE_PERCENT, SQRT_PRICE_1_1
        );
        _addNativeQuoteLiquidity(hookKey, 1000 ether);

        invariantHandler = new FeeMathInvariantHandler(hook);
        targetContract(address(invariantHandler));
    }

    function testRateSelectedZero() public view {
        (uint256 total, uint256 project, uint256 programmable) = hook.quoteGrossFees(1 ether, 0);
        assertEq(total, 0.001 ether);
        assertEq(programmable, 0.001 ether);
        assertEq(project, 0);
    }

    function testFeePolicyGettersExact() public view {
        assertEq(hook.PROGRAMMABLE_FEE_OWNER(), 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c);
        assertEq(hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), 1000);
        assertEq(hook.PROGRAMMABLE_FEE_POLICY_HASH(), keccak256("programmable-volume-fee-v1"));
    }

    function testRateSelectedBelowFloor() public view {
        (uint256 total, uint256 project, uint256 programmable) = hook.quoteGrossFees(1 ether, 500);
        assertEq(total, 0.001 ether);
        assertEq(programmable, 0.001 ether);
        assertEq(project, 0);
    }

    function testRateSelectedAtFloor() public view {
        (uint256 total, uint256 project, uint256 programmable) = hook.quoteGrossFees(1 ether, 1000);
        assertEq(total, 0.001 ether);
        assertEq(programmable, 0.001 ether);
        assertEq(project, 0);
    }

    function testRateSelectedThreePercent() public view {
        (uint256 total, uint256 project, uint256 programmable) = hook.quoteGrossFees(1 ether, SELECTED_THREE_PERCENT);
        assertEq(total, 0.03 ether);
        assertEq(programmable, 0.001 ether);
        assertEq(project, 0.029 ether);
        assertEq(total, project + programmable);
    }

    function testProgrammableRoundingStartsWithIndependentCumulativeStreams() public view {
        (uint256 total, uint256 project, uint256 programmable) = hook.quoteGrossFees(1001, 1999);
        assertEq(total, 1);
        assertEq(programmable, 1);
        assertEq(project, 0);
        assertEq(programmable, FullMath.mulDiv(1001, hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR));
    }

    function testCumulativeRemaindersResistSmallSwapFragmentation() public {
        uint256 grossPerSwap = 1999;
        _swapNativeQuote(true, -grossPerSwap.toInt256(), grossPerSwap);
        assertEq(hook.programmableFeesAccrued(), 1);
        assertEq(hook.programmableFeeRemainder(), 999_000);

        (uint256 secondTotal, uint256 secondProject, uint256 secondProgrammable) =
            hook.quoteGrossFees(grossPerSwap, SELECTED_THREE_PERCENT);
        assertEq(secondProgrammable, 2);
        assertEq(secondProject, 58);
        assertEq(secondTotal, 60);

        _swapNativeQuote(true, -grossPerSwap.toInt256(), grossPerSwap);
        uint256 cumulativeGross = grossPerSwap * 2;
        assertEq(
            hook.programmableFeesAccrued(),
            FullMath.mulDiv(cumulativeGross, hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR)
        );
        assertEq(hook.programmableFeesAccrued(), 3);
        assertEq(hook.programmableFeeRemainder(), 998_000);
        assertLt(hook.programmableFeeRemainder(), RATE_DENOMINATOR);
        assertLt(hook.projectFeeRemainder(), RATE_DENOMINATOR);

        (uint256 gross, uint256 total,,) = hook.quoteExactOutputFees(1000, SELECTED_THREE_PERCENT);
        assertEq(gross - total, 1000);
    }

    function testFuzzFragmentedSwapsMatchCumulativeEntitlements(uint64 rawGross, uint8 rawCount) public {
        uint256 grossPerSwap = bound(uint256(rawGross), 1000, 0.01 ether);
        uint256 count = bound(uint256(rawCount), 1, 8);
        for (uint256 index; index < count; ++index) {
            _swapNativeQuote(true, -grossPerSwap.toInt256(), grossPerSwap);
        }

        uint256 cumulativeGross = grossPerSwap * count;
        uint256 expectedProgrammable =
            FullMath.mulDiv(cumulativeGross, hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR);
        uint256 expectedProject = FullMath.mulDiv(
            cumulativeGross, SELECTED_THREE_PERCENT - hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR
        );
        assertEq(hook.programmableFeesAccrued(), expectedProgrammable);
        assertEq(hook.projectFeesAccrued(), expectedProject);
        assertEq(hook.totalQuoteFeesAccrued(), expectedProgrammable + expectedProject);
        assertEq(
            hook.programmableFeeRemainder(),
            mulmod(cumulativeGross, hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR)
        );
        assertEq(
            hook.projectFeeRemainder(),
            mulmod(cumulativeGross, SELECTED_THREE_PERCENT - hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR)
        );
    }

    function testZeroForOneExactInput() public {
        uint256 grossQuoteInput = 1 ether;
        BalanceDelta delta = _swapNativeQuote(true, -grossQuoteInput.toInt256(), grossQuoteInput);
        (uint256 total, uint256 project, uint256 programmable) =
            hook.quoteGrossFees(grossQuoteInput, SELECTED_THREE_PERCENT);

        assertEq(uint256(-int256(delta.amount0())), grossQuoteInput);
        _assertAccrued(total, project, programmable);
    }

    function testZeroForOneExactOutput() public {
        uint256 tokenOutput = 0.01 ether;
        BalanceDelta delta = _swapNativeQuote(true, tokenOutput.toInt256(), 1 ether);
        uint256 grossQuoteInput = uint256(-int256(delta.amount0()));
        uint256 total = hook.totalQuoteFeesAccrued();
        uint256 netQuoteInput = grossQuoteInput - total;
        uint256 quotedTotal = hook.totalQuoteFeesAccrued();
        uint256 programmable = FullMath.mulDiv(grossQuoteInput, hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR);
        uint256 project = FullMath.mulDiv(
            grossQuoteInput, SELECTED_THREE_PERCENT - hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR
        );

        assertEq(uint256(int256(delta.amount1())), tokenOutput);
        assertEq(grossQuoteInput - quotedTotal, netQuoteInput);
        _assertAccrued(quotedTotal, project, programmable);
    }

    function testOneForZeroExactInput() public {
        uint256 tokenInput = 0.01 ether;
        BalanceDelta delta = _swapNativeQuote(false, -tokenInput.toInt256(), 0);
        uint256 total = hook.totalQuoteFeesAccrued();
        uint256 grossQuoteOutput = uint256(int256(delta.amount0())) + total;
        (uint256 quotedTotal, uint256 project, uint256 programmable) =
            hook.quoteGrossFees(grossQuoteOutput, SELECTED_THREE_PERCENT);

        assertEq(uint256(-int256(delta.amount1())), tokenInput);
        _assertAccrued(quotedTotal, project, programmable);
    }

    function testOneForZeroExactOutput() public {
        uint256 netQuoteOutput = 0.005 ether;
        (, uint256 total, uint256 project, uint256 programmable) =
            hook.quoteExactOutputFees(netQuoteOutput, SELECTED_THREE_PERCENT);
        BalanceDelta delta = _swapNativeQuote(false, netQuoteOutput.toInt256(), 0);

        assertEq(uint256(int256(delta.amount0())), netQuoteOutput);
        _assertAccrued(total, project, programmable);
    }

    function testSpecifiedQuotePartialFillAtomicRevert() public {
        try swapRouter.swap{ value: 100 ether }(
            hookKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(100 ether),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(-1)
            }),
            settings,
            ZERO_BYTES
        ) returns (
            BalanceDelta
        ) {
            fail();
        } catch (bytes memory reason) {
            _assertWrappedPartialFillError(reason);
        }
        assertEq(hook.totalQuoteFeesAccrued(), 0);

        try swapRouter.swap(
            hookKey,
            SwapParams({
                zeroForOne: false, amountSpecified: int256(100 ether), sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(1)
            }),
            settings,
            ZERO_BYTES
        ) returns (
            BalanceDelta
        ) {
            fail();
        } catch (bytes memory reason) {
            _assertWrappedPartialFillError(reason);
        }
        assertEq(hook.totalQuoteFeesAccrued(), 0);
    }

    function testUnspecifiedQuoteUsesExecutedDelta() public {
        BalanceDelta delta = _swapNativeQuote(false, -int256(0.01 ether), 0);
        uint256 executedGrossQuote = uint256(int256(delta.amount0())) + hook.totalQuoteFeesAccrued();
        (uint256 expectedTotal,,) = hook.quoteGrossFees(executedGrossQuote, SELECTED_THREE_PERCENT);
        assertEq(hook.totalQuoteFeesAccrued(), expectedTotal);
    }

    function testDustBelowFeeQuantumAtomicRevert() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableVolumeFeeHookV1.QuoteAmountBelowFeeQuantum.selector, 999, hook.MIN_GROSS_QUOTE_AMOUNT()
            )
        );
        hook.quoteGrossFees(999, 0);

        (uint256 total,, uint256 programmable) = hook.quoteGrossFees(1000, 0);
        assertEq(total, 1);
        assertEq(programmable, 1);

        (uint256 gross, uint256 exactOutputTotal,, uint256 exactOutputProgrammable) = hook.quoteExactOutputFees(999, 0);
        assertEq(gross, 1000);
        assertEq(exactOutputTotal, 1);
        assertEq(exactOutputProgrammable, 1);

        vm.expectRevert();
        hook.quoteExactOutputFees(1, 0);
    }

    function testZeroExecutedQuoteCallbackCreatesNoLiability() public {
        SwapParams memory params =
            SwapParams({ zeroForOne: false, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: MAX_PRICE_LIMIT });
        vm.prank(address(manager));
        hook.afterSwap(address(this), hookKey, params, BalanceDelta.wrap(0), ZERO_BYTES);
        assertEq(hook.totalQuoteFeesAccrued(), 0);
        assertEq(hook.programmableFeesAccrued(), 0);
        assertEq(hook.projectFeesAccrued(), 0);
    }

    function testCanonicalPoolOnly() public {
        PoolKey memory altered = hookKey;
        altered.fee = 500;
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });

        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableVolumeFeeHookV1.UnexpectedPool.selector, PoolId.unwrap(altered.toId()), poolId
            )
        );
        hook.beforeSwap(address(this), altered, params, ZERO_BYTES);
    }

    function testRegistrationRejectsInvalidPoolKeysWithoutBrickingTheHook() public {
        ProgrammableVolumeFeeHookV1 candidate = _deployHook(address(projectToken));
        PoolKey memory candidateKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(projectToken)),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: candidate
        });

        PoolKey memory unsorted = PoolKey({
            currency0: Currency.wrap(address(projectToken)),
            currency1: CurrencyLibrary.ADDRESS_ZERO,
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: candidate
        });
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableVolumeFeeHookV1.CurrenciesOutOfOrderOrEqual.selector, address(projectToken), address(0)
            )
        );
        candidate.registerCanonicalPool(unsorted, projectFeeOwner, 0, 0, SQRT_PRICE_1_1);

        PoolKey memory invalidSpacing = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(projectToken)),
            fee: LP_FEE_PIPS,
            tickSpacing: 0,
            hooks: candidate
        });
        vm.expectRevert(abi.encodeWithSelector(ProgrammableVolumeFeeHookV1.InvalidTickSpacing.selector, int24(0)));
        candidate.registerCanonicalPool(invalidSpacing, projectFeeOwner, 0, 0, SQRT_PRICE_1_1);

        PoolKey memory invalidFee = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(projectToken)),
            fee: 1_000_001,
            tickSpacing: TICK_SPACING,
            hooks: candidate
        });
        vm.expectRevert(abi.encodeWithSelector(ProgrammableVolumeFeeHookV1.InvalidLpFee.selector, uint24(1_000_001)));
        candidate.registerCanonicalPool(invalidFee, projectFeeOwner, 0, 0, SQRT_PRICE_1_1);

        invalidFee.fee = 999_999;
        vm.expectRevert(abi.encodeWithSelector(ProgrammableVolumeFeeHookV1.InvalidLpFee.selector, uint24(999_999)));
        candidate.registerCanonicalPool(invalidFee, projectFeeOwner, 0, 0, SQRT_PRICE_1_1);

        invalidFee.fee = 1_000_000;
        vm.expectRevert(abi.encodeWithSelector(ProgrammableVolumeFeeHookV1.InvalidLpFee.selector, uint24(1_000_000)));
        candidate.registerCanonicalPool(invalidFee, projectFeeOwner, 0, 0, SQRT_PRICE_1_1);

        PoolKey memory dynamicFee = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(projectToken)),
            fee: 0x800000,
            tickSpacing: TICK_SPACING,
            hooks: candidate
        });
        vm.expectRevert(abi.encodeWithSelector(ProgrammableVolumeFeeHookV1.InvalidLpFee.selector, uint24(0x800000)));
        candidate.registerCanonicalPool(dynamicFee, projectFeeOwner, 0, 0, SQRT_PRICE_1_1);

        vm.expectRevert();
        candidate.registerCanonicalPool(candidateKey, projectFeeOwner, 0, 0, 0);

        assertFalse(candidate.canonicalPoolRegistered());
        candidate.registerCanonicalPool(candidateKey, projectFeeOwner, 0, 0, SQRT_PRICE_1_1);
        assertTrue(candidate.canonicalPoolRegistered());
    }

    function testPoolManagerCallbackAuthentication() public {
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), hookKey, params, ZERO_BYTES);
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), hookKey, params, BalanceDelta.wrap(0), ZERO_BYTES);
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback(ZERO_BYTES);
    }

    function testHookAddressPermissionBits() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertEq(uint160(address(hook)) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());
        assertTrue(hookFactory.configurationHashOf(address(hook)) != bytes32(0));
    }

    function testDeltaAndLiabilityConservation() public {
        _swapNativeQuote(true, -int256(1 ether), 1 ether);
        assertEq(hook.totalQuoteFeesAccrued(), hook.projectFeesAccrued() + hook.programmableFeesAccrued());
        assertEq(
            hook.claimableLiability(poolId, address(0), hook.PROGRAMMABLE_FEE_OWNER()), hook.programmableFeesAccrued()
        );
        assertEq(hook.claimableLiability(poolId, address(0), projectFeeOwner), hook.projectFeesAccrued());
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), hook.totalQuoteFeesAccrued());
    }

    function testProgrammableOwnerOnlyClaim() public {
        _swapNativeQuote(true, -int256(1 ether), 1 ether);
        address programmableOwner = hook.PROGRAMMABLE_FEE_OWNER();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableVolumeFeeHookV1.UnauthorizedClaim.selector, attacker, programmableOwner)
        );
        hook.claimProgrammableFees(attacker);
    }

    function testOwnerSelectedPerClaimDestination() public {
        _swapNativeQuote(true, -int256(1 ether), 1 ether);
        uint256 amount = hook.programmableFeesAccrued();
        address recipient = makeAddr("programmableDestination");
        vm.prank(hook.PROGRAMMABLE_FEE_OWNER());
        hook.claimProgrammableFees(recipient);

        assertEq(recipient.balance, amount);
        assertEq(hook.programmableFeesAccrued(), 0);
        assertEq(hook.totalQuoteFeesAccrued(), hook.projectFeesAccrued());
    }

    function testClaimsPreserveBothCumulativeRemainders() public {
        _swapNativeQuote(true, -int256(1999), 1999);
        uint256 programmableRemainderBefore = hook.programmableFeeRemainder();
        uint256 projectRemainderBefore = hook.projectFeeRemainder();
        assertGt(programmableRemainderBefore, 0);
        assertGt(projectRemainderBefore, 0);

        vm.prank(hook.PROGRAMMABLE_FEE_OWNER());
        hook.claimProgrammableFees(makeAddr("programmableRemainderDestination"));
        assertEq(hook.programmableFeeRemainder(), programmableRemainderBefore);
        assertEq(hook.projectFeeRemainder(), projectRemainderBefore);

        vm.prank(projectFeeOwner);
        hook.claimProjectFees(makeAddr("projectRemainderDestination"));
        assertEq(hook.programmableFeeRemainder(), programmableRemainderBefore);
        assertEq(hook.projectFeeRemainder(), projectRemainderBefore);
    }

    function testProjectClaimSeparation() public {
        _swapNativeQuote(true, -int256(1 ether), 1 ether);
        uint256 programmableBefore = hook.programmableFeesAccrued();
        uint256 projectAmount = hook.projectFeesAccrued();
        address recipient = makeAddr("projectDestination");

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableVolumeFeeHookV1.UnauthorizedClaim.selector, attacker, projectFeeOwner)
        );
        hook.claimProjectFees(attacker);

        vm.prank(projectFeeOwner);
        hook.claimProjectFees(recipient);
        assertEq(recipient.balance, projectAmount);
        assertEq(hook.projectFeesAccrued(), 0);
        assertEq(hook.programmableFeesAccrued(), programmableBefore);
    }

    function testCrossPoolAndCurrencyIsolation() public {
        _swapNativeQuote(true, -int256(1 ether), 1 ether);
        uint256 platformBefore = hook.programmableFeesAccrued();
        PoolKey memory other = hookKey;
        other.tickSpacing = 10;
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });

        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(address(this), other, params, ZERO_BYTES);
        assertEq(hook.programmableFeesAccrued(), platformBefore);
        assertEq(hook.quoteCurrencyAddress(), address(0));
        assertEq(hook.claimableLiability(PoolId.unwrap(other.toId()), address(0), hook.PROGRAMMABLE_FEE_OWNER()), 0);
        assertEq(hook.claimableLiability(poolId, address(projectToken), hook.PROGRAMMABLE_FEE_OWNER()), 0);
    }

    function testSamePoolSelfCallForbidden() public view {
        assertTrue(hook.SAME_POOL_SWAP_FORBIDDEN());
    }

    function testClaimTokenSettlementAndTake() public {
        _swapNativeQuote(true, -int256(1 ether), 1 ether);
        uint256 claimBalanceBefore = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        uint256 platformAmount = hook.programmableFeesAccrued();
        address recipient = makeAddr("claimTokenDestination");

        vm.prank(hook.PROGRAMMABLE_FEE_OWNER());
        hook.claimProgrammableFees(recipient);
        assertEq(
            manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), claimBalanceBefore - platformAmount
        );
        assertEq(recipient.balance, platformAmount);
    }

    function testErc20QuoteCurrencyOneCoversAllFourQuadrants() public {
        MockReferenceToken tokenA = new MockReferenceToken("Token A", "A");
        MockReferenceToken tokenB = new MockReferenceToken("Token B", "B");
        MockReferenceToken lower = address(tokenA) < address(tokenB) ? tokenA : tokenB;
        MockReferenceToken quote = address(tokenA) < address(tokenB) ? tokenB : tokenA;
        lower.mint(address(this), 10_000 ether);
        quote.mint(address(this), 10_000 ether);
        lower.approve(address(modifyLiquidityRouter), type(uint256).max);
        quote.approve(address(modifyLiquidityRouter), type(uint256).max);
        lower.approve(address(swapRouter), type(uint256).max);
        quote.approve(address(swapRouter), type(uint256).max);

        ProgrammableVolumeFeeHookV1 erc20QuoteHook = _deployHook(address(quote));
        PoolKey memory erc20Key = PoolKey({
            currency0: Currency.wrap(address(lower)),
            currency1: Currency.wrap(address(quote)),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: erc20QuoteHook
        });
        erc20QuoteHook.registerCanonicalPool(erc20Key, projectFeeOwner, 0, 0, SQRT_PRICE_1_1);
        ModifyLiquidityParams memory liquidity =
            ModifyLiquidityParams({ tickLower: -120, tickUpper: 120, liquidityDelta: 100 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity(erc20Key, liquidity, ZERO_BYTES);

        swapRouter.swap(
            erc20Key,
            SwapParams({ zeroForOne: true, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT }),
            settings,
            ZERO_BYTES
        );
        assertFalse(erc20QuoteHook.quoteIsCurrency0());
        uint256 firstAccrual = erc20QuoteHook.programmableFeesAccrued();
        assertGt(firstAccrual, 0);

        swapRouter.swap(
            erc20Key,
            SwapParams({ zeroForOne: true, amountSpecified: int256(0.005 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT }),
            settings,
            ZERO_BYTES
        );
        uint256 secondAccrual = erc20QuoteHook.programmableFeesAccrued();
        assertGt(secondAccrual, firstAccrual);

        swapRouter.swap(
            erc20Key,
            SwapParams({ zeroForOne: false, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: MAX_PRICE_LIMIT }),
            settings,
            ZERO_BYTES
        );
        uint256 thirdAccrual = erc20QuoteHook.programmableFeesAccrued();
        assertGt(thirdAccrual, secondAccrual);

        swapRouter.swap(
            erc20Key,
            SwapParams({ zeroForOne: false, amountSpecified: int256(0.005 ether), sqrtPriceLimitX96: MAX_PRICE_LIMIT }),
            settings,
            ZERO_BYTES
        );
        assertGt(erc20QuoteHook.programmableFeesAccrued(), thirdAccrual);
    }

    function testFuzzGrossAccountingConservesPolicy(uint96 rawGross, uint32 rawSelected) public view {
        uint256 gross = bound(uint256(rawGross), 1000, 1_000_000 ether);
        uint32 selected = uint32(bound(rawSelected, 0, hook.MAX_SELECTED_HUNDREDTHS_OF_BIP()));
        uint32 effective = hook.effectiveTotalHundredthsOfBip(selected);
        (uint256 total, uint256 project, uint256 programmable) = hook.quoteGrossFees(gross, selected);

        assertEq(programmable, FullMath.mulDiv(gross, hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR));
        assertEq(project, FullMath.mulDiv(gross, effective - hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(), RATE_DENOMINATOR));
        assertEq(total, project + programmable);
    }

    function testFuzzExactOutputRoundingPreservesNet(uint96 rawNet, uint32 rawSelected) public view {
        uint256 net = bound(uint256(rawNet), 1000, 1_000_000 ether);
        uint32 selected = uint32(bound(rawSelected, 0, hook.MAX_SELECTED_HUNDREDTHS_OF_BIP()));
        (uint256 gross, uint256 total, uint256 project, uint256 programmable) = hook.quoteExactOutputFees(net, selected);
        assertEq(gross - total, net);
        assertEq(total, project + programmable);
    }

    function testFuzzExactOutputRoundingWithCarriedRemainders(uint96 rawNet, uint32 rawSelected) public {
        _swapNativeQuote(true, -int256(1999), 1999);
        assertGt(hook.programmableFeeRemainder(), 0);
        assertGt(hook.projectFeeRemainder(), 0);

        uint256 net = bound(uint256(rawNet), 1000, 1_000_000 ether);
        uint32 selected = uint32(bound(rawSelected, 0, hook.MAX_SELECTED_HUNDREDTHS_OF_BIP()));
        (uint256 gross, uint256 total, uint256 project, uint256 programmable) = hook.quoteExactOutputFees(net, selected);
        assertEq(gross - total, net);
        assertEq(total, project + programmable);
    }

    function invariantFeeComponentsConserveTotal() public view {
        assertFalse(invariantHandler.conservationViolated());
    }

    function invariantEveryAcceptedNonzeroSwapHasPlatformLiability() public view {
        assertFalse(invariantHandler.platformFloorViolated());
    }

    function invariantExactOutputGrossMinusFeesEqualsRequestedNet() public view {
        assertFalse(invariantHandler.exactOutputNetViolated());
    }

    function _deployHook(address quoteCurrency) private returns (ProgrammableVolumeFeeHookV1 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(ProgrammableVolumeFeeHookV1).creationCode,
            abi.encode(manager, address(this), quoteCurrency)
        );
        deployed = hookFactory.deploy(salt, manager, address(this), quoteCurrency);
    }

    function _addNativeQuoteLiquidity(PoolKey memory key, uint256 amount) private {
        ModifyLiquidityParams memory liquidity =
            ModifyLiquidityParams({ tickLower: -120, tickUpper: 120, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: amount }(key, liquidity, ZERO_BYTES);
    }

    function _swapNativeQuote(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta) {
        return swapRouter.swap{ value: value }(
            hookKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            settings,
            ZERO_BYTES
        );
    }

    function _assertAccrued(uint256 total, uint256 project, uint256 programmable) private view {
        assertEq(hook.totalQuoteFeesAccrued(), total);
        assertEq(hook.projectFeesAccrued(), project);
        assertEq(hook.programmableFeesAccrued(), programmable);
        assertEq(total, project + programmable);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), total);
    }

    function decodeWrappedError(bytes calldata reason)
        external
        pure
        returns (address target, bytes4 callbackSelector, bytes memory innerReason, bytes memory details)
    {
        require(reason.length >= 4 && bytes4(reason[:4]) == CustomRevert.WrappedError.selector, "not WrappedError");
        return abi.decode(reason[4:], (address, bytes4, bytes, bytes));
    }

    function _assertWrappedPartialFillError(bytes memory reason) private view {
        (address target, bytes4 callbackSelector, bytes memory innerReason,) = this.decodeWrappedError(reason);
        assertEq(target, address(hook));
        assertEq(callbackSelector, IHooks.afterSwap.selector);
        assertEq(_leadingSelector(innerReason), ProgrammableVolumeFeeHookV1.PartialFillUnsupported.selector);
    }

    function _leadingSelector(bytes memory data) private pure returns (bytes4 selector) {
        require(data.length >= 4, "missing selector");
        assembly ("memory-safe") {
            selector := mload(add(data, 0x20))
        }
    }
}
