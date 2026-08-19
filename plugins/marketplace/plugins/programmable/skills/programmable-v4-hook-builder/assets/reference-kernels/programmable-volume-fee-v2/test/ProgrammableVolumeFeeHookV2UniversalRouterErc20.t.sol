// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { IV4Router } from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { QuoterRevert } from "@uniswap/v4-periphery/src/libraries/QuoterRevert.sol";

import { ProgrammableVolumeFeeHookV2 } from "../src/ProgrammableVolumeFeeHookV2.sol";
import { MockReferenceToken } from "./MockReferenceToken.sol";
import { ProgrammableVolumeFeeHookV2Erc20Fixture } from "./helpers/ProgrammableVolumeFeeHookV2Erc20Fixture.sol";
import {
    IUniversalRouterV4,
    UniversalRouterV4Fixture,
    V4PlannerParityEncoder
} from "./helpers/UniversalRouterV4Fixture.sol";

contract ProgrammableVolumeFeeHookV2UniversalRouterErc20Test is
    ProgrammableVolumeFeeHookV2Erc20Fixture,
    UniversalRouterV4Fixture
{
    uint24 private constant BRIDGE_LP_FEE_PIPS = 500;
    int24 private constant BRIDGE_TICK_SPACING = 10;
    string private constant UNIVERSAL_ROUTER_ARTIFACT =
        "node_modules/@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json";

    MockReferenceToken internal bridgeToken;

    function setUp() public {
        _setUpErc20Pool();

        address pinnedPermit2 = vm.deployCode("PinnedPermit2Artifact.sol:PinnedPermit2Artifact");
        address router =
            vm.deployCode(UNIVERSAL_ROUTER_ARTIFACT, _universalRouterConstructorArgs(manager, pinnedPermit2));
        _bindUniversalRouter(router);
        _bindV4Quoter(manager);

        bridgeToken = new MockReferenceToken("Reference Bridge", "RBRIDGE");
        bridgeToken.mint(address(this), 10_000_000 ether);
        bridgeToken.approve(address(modifyLiquidityRouter), type(uint256).max);

        _approvePermit2(quoteToken);
        _approvePermit2(launchedToken);
        _approvePermit2(bridgeToken);
        _initializeBridgePool();
    }

    function testV4QuoterToUniversalRouterPermit2ExactInputBuy() public {
        uint128 grossQuoteInput = 1 ether;
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            erc20Hook.quoteGrossFees(grossQuoteInput, ERC20_SELECTED_THREE_PERCENT);

        uint256 quotedAmountOut = _quoteExactInputSingle(erc20HookKey, _buyZeroForOne(), grossQuoteInput, ZERO_BYTES);
        assertGt(quotedAmountOut, 0);
        assertEq(quoteToken.balanceOf(address(this)), quoteBefore, "quote moved input");
        assertEq(launchedToken.balanceOf(address(this)), launchedBefore, "quote moved output");
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 0, "quote accrued a fee");
        _assertNoTradeEffects(quoteBefore, launchedBefore);
        uint256 amountOutMinimum = quotedAmountOut * 9900 / 10_000;

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactInputSingle(
            erc20HookKey,
            _buyZeroForOne(),
            grossQuoteInput,
            uint128(amountOutMinimum),
            ZERO_BYTES,
            Currency.wrap(address(quoteToken)),
            Currency.wrap(address(launchedToken))
        );
        universalRouter.execute(commands, inputs, block.timestamp + 60);

        assertEq(quoteBefore - quoteToken.balanceOf(address(this)), grossQuoteInput);
        assertEq(launchedToken.balanceOf(address(this)) - launchedBefore, quotedAmountOut);
        assertGe(quotedAmountOut, amountOutMinimum);
        _assertFeeAccrual(expectedTotal, expectedProject, expectedProgrammable);
        _assertRouterHasNoDust();
        assertEq(quoteToken.allowance(address(this), permit2), type(uint256).max, "Permit2 token approval missing");
        assertEq(quoteToken.allowance(address(this), address(universalRouter)), 0, "direct router approval used");
    }

    function testV4QuoterToUniversalRouterPermit2ExactInputSell() public {
        uint128 launchedInput = 0.01 ether;
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        uint256 quotedAmountOut = _quoteExactInputSingle(erc20HookKey, _sellZeroForOne(), launchedInput, ZERO_BYTES);
        _assertNoTradeEffects(quoteBefore, launchedBefore);
        uint256 grossQuoteOutput = _findCurrentWitness(quotedAmountOut);
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            erc20Hook.previewGrossFees(grossQuoteOutput, ERC20_SELECTED_THREE_PERCENT, 0, 0);
        assertEq(grossQuoteOutput, quotedAmountOut + expectedTotal, "quote-fee conservation mismatch");
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 0, "quote accrued a fee");
        uint256 amountOutMinimum = quotedAmountOut * 9900 / 10_000;

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactInputSingle(
            erc20HookKey,
            _sellZeroForOne(),
            launchedInput,
            uint128(amountOutMinimum),
            ZERO_BYTES,
            Currency.wrap(address(launchedToken)),
            Currency.wrap(address(quoteToken))
        );
        universalRouter.execute(commands, inputs, block.timestamp + 60);

        assertEq(launchedBefore - launchedToken.balanceOf(address(this)), launchedInput);
        assertEq(quoteToken.balanceOf(address(this)) - quoteBefore, quotedAmountOut);
        assertGe(quotedAmountOut, amountOutMinimum);
        _assertFeeAccrual(expectedTotal, expectedProject, expectedProgrammable);
        _assertRouterHasNoDust();
        assertEq(launchedToken.allowance(address(this), permit2), type(uint256).max, "Permit2 token approval missing");
        assertEq(launchedToken.allowance(address(this), address(universalRouter)), 0, "direct router approval used");
    }

    function testV4QuoterToUniversalRouterPermit2ExactOutputSell() public {
        uint128 netQuoteOutput = 970_000;
        uint256 grossQuoteWitness = 1_000_000;
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        bytes memory hookData = abi.encode(grossQuoteWitness);
        uint256 quotedAmountIn = _quoteExactOutputSingle(erc20HookKey, _sellZeroForOne(), netQuoteOutput, hookData);
        _assertNoTradeEffects(quoteBefore, launchedBefore);
        uint256 amountInMaximum = (quotedAmountIn * 10_100 + 9999) / 10_000;
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 0, "quote accrued a fee");

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutputSingle(
            erc20HookKey,
            _sellZeroForOne(),
            netQuoteOutput,
            uint128(amountInMaximum),
            hookData,
            Currency.wrap(address(launchedToken)),
            Currency.wrap(address(quoteToken))
        );
        universalRouter.execute(commands, inputs, block.timestamp + 60);

        assertEq(quoteToken.balanceOf(address(this)) - quoteBefore, netQuoteOutput);
        assertEq(launchedBefore - launchedToken.balanceOf(address(this)), quotedAmountIn);
        assertLe(quotedAmountIn, amountInMaximum);
        _assertFeeAccrual(30_000, 29_000, 1000);
        _assertRouterHasNoDust();
        assertEq(launchedToken.allowance(address(this), permit2), type(uint256).max, "Permit2 token approval missing");
        assertEq(launchedToken.allowance(address(this), address(universalRouter)), 0, "direct router approval used");
    }

    function testV4QuoterToUniversalRouterPermit2ExactOutputBuy() public {
        uint128 launchedOutput = 0.01 ether;
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        uint256 grossQuoteWitness = _discoverExactOutputBuyWitness(launchedOutput);
        bytes memory hookData = abi.encode(grossQuoteWitness);
        uint256 quotedAmountIn = _quoteExactOutputSingle(erc20HookKey, _buyZeroForOne(), launchedOutput, hookData);
        _assertNoTradeEffects(quoteBefore, launchedBefore);
        uint256 amountInMaximum = (quotedAmountIn * 10_100 + 9999) / 10_000;
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            erc20Hook.previewGrossFees(grossQuoteWitness, ERC20_SELECTED_THREE_PERCENT, 0, 0);
        assertEq(quotedAmountIn, grossQuoteWitness, "quoter omitted the gross quote fee");
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 0, "quote accrued a fee");

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutputSingle(
            erc20HookKey,
            _buyZeroForOne(),
            launchedOutput,
            uint128(amountInMaximum),
            hookData,
            Currency.wrap(address(quoteToken)),
            Currency.wrap(address(launchedToken))
        );
        universalRouter.execute(commands, inputs, block.timestamp + 60);

        assertEq(quoteBefore - quoteToken.balanceOf(address(this)), quotedAmountIn);
        assertEq(launchedToken.balanceOf(address(this)) - launchedBefore, launchedOutput);
        assertLe(quotedAmountIn, amountInMaximum);
        _assertFeeAccrual(expectedTotal, expectedProject, expectedProgrammable);
        _assertRouterHasNoDust();
        assertEq(quoteToken.allowance(address(this), permit2), type(uint256).max, "Permit2 token approval missing");
        assertEq(quoteToken.allowance(address(this), address(universalRouter)), 0, "direct router approval used");
    }

    function testQuotedExactInputTighterMinimumOutputRevertsWithoutEffects() public {
        uint128 grossQuoteInput = 1 ether;
        uint256 quotedAmountOut = _quoteExactInputSingle(erc20HookKey, _buyZeroForOne(), grossQuoteInput, ZERO_BYTES);
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactInputSingle(
            erc20HookKey,
            _buyZeroForOne(),
            grossQuoteInput,
            uint128(quotedAmountOut + 1),
            ZERO_BYTES,
            Currency.wrap(address(quoteToken)),
            Currency.wrap(address(launchedToken))
        );

        try universalRouter.execute(commands, inputs, block.timestamp + 60) {
            fail();
        } catch (bytes memory reason) {
            _assertRouterActionFailure(reason, IV4Router.V4TooLittleReceived.selector);
        }

        _assertNoTradeEffects(quoteBefore, launchedBefore);
    }

    function testQuotedExactOutputTighterMaximumInputRevertsWithoutEffects() public {
        uint128 netQuoteOutput = 970_000;
        bytes memory hookData = abi.encode(uint256(1_000_000));
        uint256 quotedAmountIn = _quoteExactOutputSingle(erc20HookKey, _sellZeroForOne(), netQuoteOutput, hookData);
        assertGt(quotedAmountIn, 1);
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutputSingle(
            erc20HookKey,
            _sellZeroForOne(),
            netQuoteOutput,
            uint128(quotedAmountIn - 1),
            hookData,
            Currency.wrap(address(launchedToken)),
            Currency.wrap(address(quoteToken))
        );

        try universalRouter.execute(commands, inputs, block.timestamp + 60) {
            fail();
        } catch (bytes memory reason) {
            _assertRouterActionFailure(reason, IV4Router.V4TooMuchRequested.selector);
        }

        _assertNoTradeEffects(quoteBefore, launchedBefore);
    }

    function testQuotedExecutionExpiredDeadlineRevertsWithoutEffects() public {
        uint128 grossQuoteInput = 1 ether;
        uint256 quotedAmountOut = _quoteExactInputSingle(erc20HookKey, _buyZeroForOne(), grossQuoteInput, ZERO_BYTES);
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactInputSingle(
            erc20HookKey,
            _buyZeroForOne(),
            grossQuoteInput,
            uint128(quotedAmountOut * 9900 / 10_000),
            ZERO_BYTES,
            Currency.wrap(address(quoteToken)),
            Currency.wrap(address(launchedToken))
        );
        uint256 deadline = block.timestamp + 60;
        vm.warp(deadline + 1);

        vm.expectRevert(IUniversalRouterV4.TransactionDeadlinePassed.selector);
        universalRouter.execute(commands, inputs, deadline);

        _assertNoTradeEffects(quoteBefore, launchedBefore);
    }

    function testQuotedExecutionHookDataMismatchRevertsWithoutEffects() public {
        uint128 netQuoteOutput = 970_000;
        bytes memory quotedHookData = abi.encode(uint256(1_000_000));
        uint256 quotedAmountIn =
            _quoteExactOutputSingle(erc20HookKey, _sellZeroForOne(), netQuoteOutput, quotedHookData);
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutputSingle(
            erc20HookKey,
            _sellZeroForOne(),
            netQuoteOutput,
            uint128((quotedAmountIn * 10_100 + 9999) / 10_000),
            abi.encode(uint256(1_000_001)),
            Currency.wrap(address(launchedToken)),
            Currency.wrap(address(quoteToken))
        );

        try universalRouter.execute(commands, inputs, block.timestamp + 60) {
            fail();
        } catch (bytes memory reason) {
            (address target, bytes4 callbackSelector, bytes memory innerReason,) =
                this.decodeWrappedQuoteFailure(reason);
            assertEq(target, address(erc20Hook), "unexpected hookData failure target");
            assertEq(callbackSelector, IHooks.beforeSwap.selector, "unexpected hookData callback");
            this.decodeInvalidWitness(innerReason);
        }

        _assertNoTradeEffects(quoteBefore, launchedBefore);
    }

    function testUniversalRouterPermit2Erc20ExactInputMultihop() public {
        uint128 grossQuoteInput = 0.01 ether;
        uint256 bridgeBefore = bridgeToken.balanceOf(address(this));
        PathKey[] memory path = new PathKey[](2);
        path[0] = PathKey({
            intermediateCurrency: Currency.wrap(address(launchedToken)),
            fee: ERC20_LP_FEE_PIPS,
            tickSpacing: ERC20_TICK_SPACING,
            hooks: erc20Hook,
            hookData: ZERO_BYTES
        });
        path[1] = PathKey({
            intermediateCurrency: Currency.wrap(address(bridgeToken)),
            fee: BRIDGE_LP_FEE_PIPS,
            tickSpacing: BRIDGE_TICK_SPACING,
            hooks: IHooks(address(0)),
            hookData: hex"556677"
        });

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactInput(
            Currency.wrap(address(quoteToken)), path, grossQuoteInput, 1, Currency.wrap(address(bridgeToken))
        );
        universalRouter.execute(commands, inputs, block.timestamp);

        assertGt(bridgeToken.balanceOf(address(this)), bridgeBefore);
        assertGt(erc20Hook.totalQuoteFeesAccrued(), 0);
        _assertRouterHasNoDust();
    }

    function testUniversalRouterPermit2Erc20ExactOutputMultihopPreservesPerHopHookData() public {
        uint128 netQuoteOutput = 970_000;
        uint256 grossQuoteWitness = 1_000_000;
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        PathKey[] memory path = new PathKey[](2);
        // Exact-output paths retain pool order but name each hop's input-side currency. The router walks them
        // backwards.
        path[0] = PathKey({
            intermediateCurrency: Currency.wrap(address(bridgeToken)),
            fee: BRIDGE_LP_FEE_PIPS,
            tickSpacing: BRIDGE_TICK_SPACING,
            hooks: IHooks(address(0)),
            hookData: hex"1122"
        });
        path[1] = PathKey({
            intermediateCurrency: Currency.wrap(address(launchedToken)),
            fee: ERC20_LP_FEE_PIPS,
            tickSpacing: ERC20_TICK_SPACING,
            hooks: erc20Hook,
            hookData: abi.encode(grossQuoteWitness)
        });

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutput(
            Currency.wrap(address(bridgeToken)), Currency.wrap(address(quoteToken)), path, netQuoteOutput, 1 ether
        );
        universalRouter.execute(commands, inputs, block.timestamp);

        assertEq(quoteToken.balanceOf(address(this)) - quoteBefore, netQuoteOutput);
        _assertFeeAccrual(30_000, 29_000, 1000);
        _assertRouterHasNoDust();
    }

    function _initializeBridgePool() private {
        Currency launched = Currency.wrap(address(launchedToken));
        Currency bridge = Currency.wrap(address(bridgeToken));
        (Currency currency0, Currency currency1) =
            address(launchedToken) < address(bridgeToken) ? (launched, bridge) : (bridge, launched);
        (PoolKey memory bridgeKey,) = initPool(
            currency0, currency1, IHooks(address(0)), BRIDGE_LP_FEE_PIPS, BRIDGE_TICK_SPACING, SQRT_PRICE_1_1
        );
        ModifyLiquidityParams memory liquidity =
            ModifyLiquidityParams({ tickLower: -120, tickUpper: 120, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity(bridgeKey, liquidity, ZERO_BYTES);
    }

    function _discoverExactOutputBuyWitness(uint128 launchedOutput) private returns (uint256 grossQuoteWitness) {
        bytes memory wrappedFailure;
        try v4Quoter.quoteExactOutputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: erc20HookKey,
                zeroForOne: _buyZeroForOne(),
                exactAmount: launchedOutput,
                hookData: abi.encode(uint256(1))
            })
        ) returns (
            uint256, uint256
        ) {
            fail();
        } catch (bytes memory reason) {
            wrappedFailure = this.decodeUnexpectedQuoteFailure(reason);
        }
        (address target, bytes4 callbackSelector, bytes memory innerReason,) =
            this.decodeWrappedQuoteFailure(wrappedFailure);
        assertEq(target, address(erc20Hook), "unexpected exact-output failure target");
        assertEq(callbackSelector, IHooks.afterSwap.selector, "unexpected exact-output callback");
        (uint256 netQuoteInput,) = this.decodeInvalidWitness(innerReason);
        grossQuoteWitness = _findCurrentWitness(netQuoteInput);
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

    function decodeUnexpectedQuoteFailure(bytes calldata reason) external pure returns (bytes memory wrappedFailure) {
        require(
            reason.length >= 4 && bytes4(reason[:4]) == QuoterRevert.UnexpectedRevertBytes.selector,
            "not UnexpectedRevertBytes"
        );
        return abi.decode(reason[4:], (bytes));
    }

    function decodeWrappedQuoteFailure(bytes calldata reason)
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

    function _assertFeeAccrual(uint256 total, uint256 project, uint256 programmable) private view {
        assertEq(erc20Hook.totalQuoteFeesAccrued(), total);
        assertEq(erc20Hook.projectFeesAccrued(), project);
        assertEq(erc20Hook.programmableFeesAccrued(), programmable);
        assertEq(total, project + programmable);
        assertEq(manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId()), total);
        assertGe(quoteToken.balanceOf(address(manager)), total);
    }

    function _assertRouterActionFailure(bytes memory reason, bytes4 expectedSelector) private pure {
        require(reason.length >= 4, "missing router action error");
        require(bytes4(reason) == expectedSelector, "unexpected router action error");
    }

    function _assertNoTradeEffects(uint256 quoteBefore, uint256 launchedBefore) private view {
        assertEq(quoteToken.balanceOf(address(this)), quoteBefore, "quote balance changed");
        assertEq(launchedToken.balanceOf(address(this)), launchedBefore, "launched balance changed");
        assertEq(erc20Hook.totalQuoteFeesAccrued(), 0, "fee liability changed");
        assertEq(erc20Hook.projectFeesAccrued(), 0, "project fee liability changed");
        assertEq(erc20Hook.programmableFeesAccrued(), 0, "Programmable fee liability changed");
        assertEq(erc20Hook.projectFeeRemainder(), 0, "project remainder changed");
        assertEq(erc20Hook.programmableFeeRemainder(), 0, "Programmable remainder changed");
        assertEq(manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId()), 0);
        _assertRouterHasNoDust();
    }

    function _assertRouterHasNoDust() private view {
        assertEq(quoteToken.balanceOf(address(universalRouter)), 0);
        assertEq(launchedToken.balanceOf(address(universalRouter)), 0);
        assertEq(bridgeToken.balanceOf(address(universalRouter)), 0);
        assertEq(address(universalRouter).balance, 0);
    }
}
