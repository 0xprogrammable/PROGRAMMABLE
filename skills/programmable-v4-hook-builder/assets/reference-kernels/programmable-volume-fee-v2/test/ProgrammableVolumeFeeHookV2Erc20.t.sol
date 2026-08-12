// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

import { ProgrammableVolumeFeeHookV2 } from "../src/ProgrammableVolumeFeeHookV2.sol";
import { ProgrammableVolumeFeeHookV2Erc20Fixture } from "./helpers/ProgrammableVolumeFeeHookV2Erc20Fixture.sol";

contract ProgrammableVolumeFeeHookV2Erc20Test is ProgrammableVolumeFeeHookV2Erc20Fixture {
    using SafeCast for uint256;

    function setUp() public {
        _setUpErc20Pool();
    }

    function testErc20QuoteExactInputBuyAccruesFundedClaimsAndBothOwnersRedeem() public {
        uint256 grossQuoteInput = 1 ether;
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            erc20Hook.quoteGrossFees(grossQuoteInput, ERC20_SELECTED_THREE_PERCENT);
        BalanceDelta delta = swapRouter.swap(
            erc20HookKey,
            SwapParams({
                zeroForOne: _buyZeroForOne(),
                amountSpecified: -grossQuoteInput.toInt256(),
                sqrtPriceLimitX96: _priceLimit(_buyZeroForOne())
            }),
            erc20SwapSettings,
            ZERO_BYTES
        );

        assertEq(_absolute(_quoteDelta(delta)), grossQuoteInput);
        _assertAccrual(expectedTotal, expectedProject, expectedProgrammable);
        _claimBothAndAssert(expectedProject, expectedProgrammable);
    }

    function testErc20QuoteExactInputSellUsesExecutedGrossAndClaims() public {
        BalanceDelta delta = swapRouter.swap(
            erc20HookKey,
            SwapParams({
                zeroForOne: _sellZeroForOne(),
                amountSpecified: -int256(0.01 ether),
                sqrtPriceLimitX96: _priceLimit(_sellZeroForOne())
            }),
            erc20SwapSettings,
            ZERO_BYTES
        );
        uint256 total = erc20Hook.totalQuoteFeesAccrued();
        uint256 netQuoteOutput = uint256(_quoteDelta(delta));
        uint256 executedGrossQuoteOutput = netQuoteOutput + total;
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            erc20Hook.previewGrossFees(executedGrossQuoteOutput, ERC20_SELECTED_THREE_PERCENT, 0, 0);

        _assertAccrual(expectedTotal, expectedProject, expectedProgrammable);
        _claimBothAndAssert(expectedProject, expectedProgrammable);
    }

    function testErc20QuoteExactOutputBuyUsesCurrentGrossWitnessAndClaims() public {
        SwapParams memory params = SwapParams({
            zeroForOne: _buyZeroForOne(),
            amountSpecified: int256(0.01 ether),
            sqrtPriceLimitX96: _priceLimit(_buyZeroForOne())
        });
        uint256 executedNetQuoteInput;
        try swapRouter.swap(erc20HookKey, params, erc20SwapSettings, abi.encode(uint256(1))) returns (BalanceDelta) {
            fail();
        } catch (bytes memory reason) {
            (address target, bytes4 callbackSelector, bytes memory innerReason,) = this.decodeWrappedError(reason);
            assertEq(target, address(erc20Hook));
            assertEq(callbackSelector, IHooks.afterSwap.selector);
            (executedNetQuoteInput,) = this.decodeInvalidWitness(innerReason);
        }

        uint256 grossQuoteWitness = _findCurrentWitness(executedNetQuoteInput);
        BalanceDelta delta = swapRouter.swap(erc20HookKey, params, erc20SwapSettings, abi.encode(grossQuoteWitness));
        assertEq(_absolute(_quoteDelta(delta)), grossQuoteWitness);

        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            erc20Hook.previewGrossFees(grossQuoteWitness, ERC20_SELECTED_THREE_PERCENT, 0, 0);
        _assertAccrual(expectedTotal, expectedProject, expectedProgrammable);
        _claimBothAndAssert(expectedProject, expectedProgrammable);
    }

    function testErc20QuoteExactOutputSellUsesGrossWitnessAndClaims() public {
        uint256 netQuoteOutput = 970_000;
        uint256 grossQuoteWitness = 1_000_000;
        BalanceDelta delta = swapRouter.swap(
            erc20HookKey,
            SwapParams({
                zeroForOne: _sellZeroForOne(),
                amountSpecified: netQuoteOutput.toInt256(),
                sqrtPriceLimitX96: _priceLimit(_sellZeroForOne())
            }),
            erc20SwapSettings,
            abi.encode(grossQuoteWitness)
        );

        assertEq(uint256(_quoteDelta(delta)), netQuoteOutput);
        _assertAccrual(30_000, 29_000, 1000);
        _claimBothAndAssert(29_000, 1000);
    }

    function testErc20SpecifiedQuotePartialFillRevertsWithoutFeesOrTokenMovement() public {
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        uint256 claimTokensBefore = manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId());
        bool zeroForOne = _buyZeroForOne();
        int24 limitTick = zeroForOne ? int24(-1) : int24(1);

        vm.expectRevert();
        swapRouter.swap(
            erc20HookKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(100 ether),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(limitTick)
            }),
            erc20SwapSettings,
            ZERO_BYTES
        );

        assertEq(quoteToken.balanceOf(address(this)), quoteBefore);
        assertEq(launchedToken.balanceOf(address(this)), launchedBefore);
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 0);
        assertEq(erc20Hook.projectFeesAccrued(), 0);
        assertEq(erc20Hook.programmableFeesAccrued(), 0);
        assertEq(erc20Hook.projectFeeRemainder(), 0);
        assertEq(erc20Hook.programmableFeeRemainder(), 0);
        assertEq(manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId()), claimTokensBefore);
    }

    function testErc20RoundingBoundaryRevertsAtomicallyThenCarriesExactly() public {
        _exactInputBuy(999);
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 28);
        assertEq(erc20Hook.projectFeesAccrued(), 28);
        assertEq(erc20Hook.programmableFeesAccrued(), 0);
        assertEq(erc20Hook.projectFeeRemainder(), 971_000);
        assertEq(erc20Hook.programmableFeeRemainder(), 999_000);

        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        uint256 claimTokensBefore = manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId());
        bool buyZeroForOne = _buyZeroForOne();
        uint160 buyPriceLimit = _priceLimit(buyZeroForOne);
        vm.expectRevert();
        swapRouter.swap(
            erc20HookKey,
            SwapParams({ zeroForOne: buyZeroForOne, amountSpecified: -int256(1), sqrtPriceLimitX96: buyPriceLimit }),
            erc20SwapSettings,
            ZERO_BYTES
        );
        assertEq(quoteToken.balanceOf(address(this)), quoteBefore);
        assertEq(launchedToken.balanceOf(address(this)), launchedBefore);
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 28);
        assertEq(erc20Hook.projectFeeRemainder(), 971_000);
        assertEq(erc20Hook.programmableFeeRemainder(), 999_000);
        assertEq(manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId()), claimTokensBefore);

        _exactInputBuy(1001);
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 60);
        assertEq(erc20Hook.projectFeesAccrued(), 58);
        assertEq(erc20Hook.programmableFeesAccrued(), 2);
        assertEq(erc20Hook.projectFeeRemainder(), 0);
        assertEq(erc20Hook.programmableFeeRemainder(), 0);
        _claimBothAndAssert(58, 2);
    }

    function testExactOutputRemainderFrontRunCanRevertButCannotTakeVictimFunds() public {
        address frontRunner = makeAddr("frontRunner");
        address victim = makeAddr("victim");
        assertTrue(quoteToken.transfer(frontRunner, 1 ether));
        assertTrue(launchedToken.transfer(victim, 1 ether));
        vm.prank(frontRunner);
        quoteToken.approve(address(swapRouter), type(uint256).max);
        vm.prank(victim);
        launchedToken.approve(address(swapRouter), type(uint256).max);

        uint256 netQuoteOutput = 999;
        uint256 staleWitness = 1029;
        (bool validBefore,,,,,) =
            erc20Hook.quoteExactOutputWitness(netQuoteOutput, staleWitness, ERC20_SELECTED_THREE_PERCENT);
        assertTrue(validBefore);

        vm.prank(frontRunner);
        swapRouter.swap(
            erc20HookKey,
            SwapParams({
                zeroForOne: _buyZeroForOne(),
                amountSpecified: -int256(999),
                sqrtPriceLimitX96: _priceLimit(_buyZeroForOne())
            }),
            erc20SwapSettings,
            ZERO_BYTES
        );
        (bool validAfter,,,,,) =
            erc20Hook.quoteExactOutputWitness(netQuoteOutput, staleWitness, ERC20_SELECTED_THREE_PERCENT);
        assertFalse(validAfter);

        uint256 victimQuoteBefore = quoteToken.balanceOf(victim);
        uint256 victimLaunchedBefore = launchedToken.balanceOf(victim);
        uint256 totalBefore = erc20Hook.totalQuoteFeesAccrued();
        uint256 projectBefore = erc20Hook.projectFeesAccrued();
        uint256 programmableBefore = erc20Hook.programmableFeesAccrued();
        uint256 projectRemainderBefore = erc20Hook.projectFeeRemainder();
        uint256 programmableRemainderBefore = erc20Hook.programmableFeeRemainder();
        uint256 claimTokensBefore = manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId());
        bool sellZeroForOne = _sellZeroForOne();
        uint160 sellPriceLimit = _priceLimit(sellZeroForOne);

        vm.prank(victim);
        vm.expectRevert();
        swapRouter.swap(
            erc20HookKey,
            SwapParams({
                zeroForOne: sellZeroForOne,
                amountSpecified: netQuoteOutput.toInt256(),
                sqrtPriceLimitX96: sellPriceLimit
            }),
            erc20SwapSettings,
            abi.encode(staleWitness)
        );

        assertEq(quoteToken.balanceOf(victim), victimQuoteBefore);
        assertEq(launchedToken.balanceOf(victim), victimLaunchedBefore);
        assertEq(erc20Hook.totalQuoteFeesAccrued(), totalBefore);
        assertEq(erc20Hook.projectFeesAccrued(), projectBefore);
        assertEq(erc20Hook.programmableFeesAccrued(), programmableBefore);
        assertEq(erc20Hook.projectFeeRemainder(), projectRemainderBefore);
        assertEq(erc20Hook.programmableFeeRemainder(), programmableRemainderBefore);
        assertEq(manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId()), claimTokensBefore);

        uint256 currentWitness = _findCurrentWitness(netQuoteOutput);
        vm.prank(victim);
        swapRouter.swap(
            erc20HookKey,
            SwapParams({
                zeroForOne: sellZeroForOne,
                amountSpecified: netQuoteOutput.toInt256(),
                sqrtPriceLimitX96: sellPriceLimit
            }),
            erc20SwapSettings,
            abi.encode(currentWitness)
        );
        assertGt(quoteToken.balanceOf(victim), victimQuoteBefore);
    }

    function _exactInputBuy(uint256 grossQuoteInput) private returns (BalanceDelta) {
        return swapRouter.swap(
            erc20HookKey,
            SwapParams({
                zeroForOne: _buyZeroForOne(),
                amountSpecified: -grossQuoteInput.toInt256(),
                sqrtPriceLimitX96: _priceLimit(_buyZeroForOne())
            }),
            erc20SwapSettings,
            ZERO_BYTES
        );
    }

    function _claimBothAndAssert(uint256 expectedProject, uint256 expectedProgrammable) private {
        uint256 projectRemainder = erc20Hook.projectFeeRemainder();
        uint256 programmableRemainder = erc20Hook.programmableFeeRemainder();
        address projectRecipient = makeAddr("erc20ProjectRecipient");
        address programmableRecipient = makeAddr("erc20ProgrammableRecipient");

        vm.prank(erc20ProjectFeeOwner);
        uint256 claimedProject = erc20Hook.claimProjectFees(projectRecipient);
        assertEq(claimedProject, expectedProject);
        assertEq(quoteToken.balanceOf(projectRecipient), expectedProject);
        assertEq(erc20Hook.programmableFeesAccrued(), expectedProgrammable);

        vm.prank(erc20Hook.PROGRAMMABLE_FEE_OWNER());
        uint256 claimedProgrammable = erc20Hook.claimProgrammableFees(programmableRecipient);
        assertEq(claimedProgrammable, expectedProgrammable);
        assertEq(quoteToken.balanceOf(programmableRecipient), expectedProgrammable);
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 0);
        assertEq(erc20Hook.projectFeesAccrued(), 0);
        assertEq(erc20Hook.programmableFeesAccrued(), 0);
        assertEq(erc20Hook.projectFeeRemainder(), projectRemainder);
        assertEq(erc20Hook.programmableFeeRemainder(), programmableRemainder);
        assertEq(manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId()), 0);
        assertEq(erc20Hook.claimableLiability(erc20PoolId, address(quoteToken), erc20ProjectFeeOwner), 0);
        assertEq(erc20Hook.claimableLiability(erc20PoolId, address(quoteToken), erc20Hook.PROGRAMMABLE_FEE_OWNER()), 0);
    }

    function _assertAccrual(uint256 total, uint256 project, uint256 programmable) private view {
        assertEq(total, project + programmable);
        assertEq(erc20Hook.totalQuoteFeesAccrued(), total);
        assertEq(erc20Hook.projectFeesAccrued(), project);
        assertEq(erc20Hook.programmableFeesAccrued(), programmable);
        assertEq(manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId()), total);
        assertGe(quoteToken.balanceOf(address(manager)), total);
    }

    function _findCurrentWitness(uint256 netQuoteAmount) private view returns (uint256 grossQuoteWitness) {
        uint256 estimate = (netQuoteAmount * 1_000_000 + 969_999) / 970_000;
        uint256 candidate = estimate > 8 ? estimate - 8 : 1;
        for (uint256 index; index < 32; ++index) {
            (bool valid,,,,,) =
                erc20Hook.quoteExactOutputWitness(netQuoteAmount, candidate, ERC20_SELECTED_THREE_PERCENT);
            if (valid) return candidate;
            ++candidate;
        }
        revert("witness not found");
    }

    function _quoteDelta(BalanceDelta delta) private view returns (int256) {
        return erc20Hook.quoteIsCurrency0() ? int256(delta.amount0()) : int256(delta.amount1());
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return SignedMath.abs(value);
    }

    function decodeWrappedError(bytes calldata reason)
        external
        pure
        returns (address target, bytes4 callbackSelector, bytes memory innerReason, bytes memory details)
    {
        require(reason.length >= 4 && bytes4(reason[:4]) == CustomRevert.WrappedError.selector, "not WrappedError");
        return abi.decode(reason[4:], (address, bytes4, bytes, bytes));
    }

    function decodeInvalidWitness(bytes calldata innerReason)
        external
        pure
        returns (uint256 netQuoteAmount, uint256 grossQuoteWitness)
    {
        require(
            innerReason.length == 68
                && bytes4(innerReason[:4]) == ProgrammableVolumeFeeHookV2.InvalidExactOutputWitness.selector,
            "not InvalidExactOutputWitness"
        );
        return abi.decode(innerReason[4:], (uint256, uint256));
    }
}
