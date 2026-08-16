// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAllowanceTransfer } from "@uniswap/permit2/src/interfaces/IAllowanceTransfer.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { IV4Router } from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { QuoterRevert } from "@uniswap/v4-periphery/src/libraries/QuoterRevert.sol";

import { ProgrammableVolumeFeeHookFactoryV2 } from "../src/ProgrammableVolumeFeeHookFactoryV2.sol";
import { ProgrammableVolumeFeeHookV2 } from "../src/ProgrammableVolumeFeeHookV2.sol";
import { MockReferenceToken } from "./MockReferenceToken.sol";
import { UniversalRouterV4Fixture, V4PlannerParityEncoder } from "./helpers/UniversalRouterV4Fixture.sol";

contract ProgrammableVolumeFeeHookV2UniversalRouterNativeTest is Deployers, UniversalRouterV4Fixture {
    uint24 private constant LP_FEE_PIPS = 3000;
    int24 private constant TICK_SPACING = 60;
    uint24 private constant BRIDGE_LP_FEE_PIPS = 500;
    int24 private constant BRIDGE_TICK_SPACING = 10;
    uint32 private constant SELECTED_THREE_PERCENT = 30_000;
    string private constant UNIVERSAL_ROUTER_ARTIFACT =
        "node_modules/@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json";

    ProgrammableVolumeFeeHookFactoryV2 internal hookFactory;
    ProgrammableVolumeFeeHookV2 internal hook;
    MockReferenceToken internal projectToken;
    MockReferenceToken internal bridgeToken;
    PoolKey internal hookKey;
    bytes32 internal evidenceHookUserSalt;

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        projectToken = new MockReferenceToken("Reference Project", "RPROJ");
        bridgeToken = new MockReferenceToken("Reference Bridge", "RBRIDGE");
        projectToken.mint(address(this), 10_000_000 ether);
        bridgeToken.mint(address(this), 10_000_000 ether);
        projectToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        bridgeToken.approve(address(modifyLiquidityRouter), type(uint256).max);

        hookFactory = new ProgrammableVolumeFeeHookFactoryV2();
        hook = _deployAndRegisterNativeHook();
        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(projectToken)),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
        ModifyLiquidityParams memory liquidity =
            ModifyLiquidityParams({ tickLower: -120, tickUpper: 120, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(hookKey, liquidity, ZERO_BYTES);
        _initializeBridgePool(liquidity);

        address pinnedPermit2 = vm.deployCode("PinnedPermit2Artifact.sol:PinnedPermit2Artifact");
        address router =
            vm.deployCode(UNIVERSAL_ROUTER_ARTIFACT, _universalRouterConstructorArgs(manager, pinnedPermit2));
        _bindUniversalRouter(router);
        _bindV4Quoter(manager);
        _approvePermit2(projectToken);
        _approvePermit2(bridgeToken);
    }

    function testV4QuoterToUniversalRouterNativeExactInputBuy() public {
        uint128 grossNativeInput = 1 ether;
        uint256 nativeBefore = address(this).balance;
        uint256 projectBefore = projectToken.balanceOf(address(this));
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            hook.quoteGrossFees(grossNativeInput, SELECTED_THREE_PERCENT);
        uint256 quotedAmountOut = _quoteExactInputSingle(hookKey, _buyZeroForOne(), grossNativeInput, ZERO_BYTES);
        assertGt(quotedAmountOut, 0);
        assertEq(address(this).balance, nativeBefore, "quote moved native input");
        assertEq(projectToken.balanceOf(address(this)), projectBefore, "quote moved token output");
        assertEq(hook.totalQuoteFeesAccrued(), 0, "quote accrued a fee");
        _assertNoTradeEffects(nativeBefore, projectBefore);
        uint256 amountOutMinimum = quotedAmountOut * 9900 / 10_000;

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactInputSingle(
            hookKey,
            _buyZeroForOne(),
            grossNativeInput,
            uint128(amountOutMinimum),
            ZERO_BYTES,
            CurrencyLibrary.ADDRESS_ZERO,
            Currency.wrap(address(projectToken))
        );
        universalRouter.execute{ value: grossNativeInput }(commands, inputs, block.timestamp + 60);

        assertEq(nativeBefore - address(this).balance, grossNativeInput);
        assertEq(projectToken.balanceOf(address(this)) - projectBefore, quotedAmountOut);
        assertGe(quotedAmountOut, amountOutMinimum);
        _assertFeeAccrual(expectedTotal, expectedProject, expectedProgrammable);
        _assertRouterHasNoDust();
    }

    function testV4QuoterToUniversalRouterNativeExactInputSell() public {
        uint128 projectInput = 0.01 ether;
        uint256 nativeBefore = address(this).balance;
        uint256 projectBefore = projectToken.balanceOf(address(this));
        uint256 quotedAmountOut = _quoteExactInputSingle(hookKey, _sellZeroForOne(), projectInput, ZERO_BYTES);
        _assertNoTradeEffects(nativeBefore, projectBefore);
        uint256 grossNativeOutput = _findCurrentWitness(quotedAmountOut);
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            hook.previewGrossFees(grossNativeOutput, SELECTED_THREE_PERCENT, 0, 0);
        assertEq(grossNativeOutput, quotedAmountOut + expectedTotal, "quote-fee conservation mismatch");
        assertEq(hook.totalQuoteFeesAccrued(), 0, "quote accrued a fee");
        uint256 amountOutMinimum = quotedAmountOut * 9900 / 10_000;

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactInputSingle(
            hookKey,
            _sellZeroForOne(),
            projectInput,
            uint128(amountOutMinimum),
            ZERO_BYTES,
            Currency.wrap(address(projectToken)),
            CurrencyLibrary.ADDRESS_ZERO
        );
        universalRouter.execute(commands, inputs, block.timestamp + 60);

        assertEq(projectBefore - projectToken.balanceOf(address(this)), projectInput);
        assertEq(address(this).balance - nativeBefore, quotedAmountOut);
        assertGe(quotedAmountOut, amountOutMinimum);
        _assertFeeAccrual(expectedTotal, expectedProject, expectedProgrammable);
        _assertRouterHasNoDust();
        assertEq(projectToken.allowance(address(this), permit2), type(uint256).max, "Permit2 token approval missing");
        assertEq(projectToken.allowance(address(this), address(universalRouter)), 0, "direct router approval used");
    }

    function testV4QuoterToUniversalRouterNativeExactOutputSell() public {
        uint128 netNativeOutput = 970_000;
        uint256 grossQuoteWitness = 1_000_000;
        uint256 nativeBefore = address(this).balance;
        uint256 projectBefore = projectToken.balanceOf(address(this));
        bytes memory hookData = abi.encode(grossQuoteWitness);
        uint256 quotedAmountIn = _quoteExactOutputSingle(hookKey, _sellZeroForOne(), netNativeOutput, hookData);
        _assertNoTradeEffects(nativeBefore, projectBefore);
        uint256 amountInMaximum = (quotedAmountIn * 10_100 + 9999) / 10_000;
        assertEq(hook.totalQuoteFeesAccrued(), 0, "quote accrued a fee");

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutputSingle(
            hookKey,
            _sellZeroForOne(),
            netNativeOutput,
            uint128(amountInMaximum),
            hookData,
            Currency.wrap(address(projectToken)),
            CurrencyLibrary.ADDRESS_ZERO
        );
        universalRouter.execute(commands, inputs, block.timestamp + 60);

        assertEq(address(this).balance - nativeBefore, netNativeOutput);
        assertEq(projectBefore - projectToken.balanceOf(address(this)), quotedAmountIn);
        assertLe(quotedAmountIn, amountInMaximum);
        _assertFeeAccrual(30_000, 29_000, 1000);
        _assertRouterHasNoDust();
        assertEq(projectToken.allowance(address(this), permit2), type(uint256).max, "Permit2 token approval missing");
        assertEq(projectToken.allowance(address(this), address(universalRouter)), 0, "direct router approval used");
    }

    function testV4QuoterToUniversalRouterNativeExactOutputBuyRefundsUnusedMaximumInput() public {
        uint128 projectOutput = 0.01 ether;
        uint256 nativeBefore = address(this).balance;
        uint256 projectBefore = projectToken.balanceOf(address(this));
        uint256 grossQuoteWitness = _discoverExactOutputBuyWitness(projectOutput);
        bytes memory hookData = abi.encode(grossQuoteWitness);
        uint256 quotedAmountIn = _quoteExactOutputSingle(hookKey, _buyZeroForOne(), projectOutput, hookData);
        _assertNoTradeEffects(nativeBefore, projectBefore);
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            hook.previewGrossFees(grossQuoteWitness, SELECTED_THREE_PERCENT, 0, 0);
        assertEq(quotedAmountIn, grossQuoteWitness, "quoter omitted the gross native fee");
        assertEq(hook.totalQuoteFeesAccrued(), 0, "quote accrued a fee");
        uint256 amountInMaximum = (quotedAmountIn * 10_100 + 9999) / 10_000;
        uint256 expectedRefund = amountInMaximum - quotedAmountIn;
        assertGt(amountInMaximum, quotedAmountIn, "test requires positive input headroom");
        assertGt(expectedRefund, 0, "test requires a positive refund");

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutputSingleNativeInput(
            hookKey,
            _buyZeroForOne(),
            projectOutput,
            uint128(amountInMaximum),
            hookData,
            Currency.wrap(address(projectToken))
        );
        assertEq(commands, hex"1004", "native exact-output route omitted SWEEP");
        vm.expectCall(address(this), expectedRefund, hex"");
        universalRouter.execute{ value: amountInMaximum }(commands, inputs, block.timestamp + 60);

        uint256 actualAmountIn = nativeBefore - address(this).balance;
        uint256 observedRefund = amountInMaximum - actualAmountIn;
        assertEq(actualAmountIn, quotedAmountIn, "execution input drifted from quote");
        assertGt(amountInMaximum, actualAmountIn, "exact-output execution consumed the full maximum");
        assertEq(observedRefund, expectedRefund, "SWEEP returned an inexact refund");
        assertEq(address(this).balance, nativeBefore - amountInMaximum + expectedRefund, "refund balance mismatch");
        assertEq(projectToken.balanceOf(address(this)) - projectBefore, projectOutput);
        _assertFeeAccrual(expectedTotal, expectedProject, expectedProgrammable);
        _assertRouterHasNoDust();
    }

    function testQuotedNativeExactOutputTighterMaximumInputRevertsWithoutEffects() public {
        uint128 projectOutput = 0.01 ether;
        uint256 grossQuoteWitness = _discoverExactOutputBuyWitness(projectOutput);
        bytes memory hookData = abi.encode(grossQuoteWitness);
        uint256 quotedAmountIn = _quoteExactOutputSingle(hookKey, _buyZeroForOne(), projectOutput, hookData);
        assertGt(quotedAmountIn, 1);
        uint256 nativeBefore = address(this).balance;
        uint256 projectBefore = projectToken.balanceOf(address(this));
        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutputSingle(
            hookKey,
            _buyZeroForOne(),
            projectOutput,
            uint128(quotedAmountIn - 1),
            hookData,
            CurrencyLibrary.ADDRESS_ZERO,
            Currency.wrap(address(projectToken))
        );

        try universalRouter.execute{ value: quotedAmountIn - 1 }(commands, inputs, block.timestamp + 60) {
            fail();
        } catch (bytes memory reason) {
            _assertRouterActionFailure(reason, IV4Router.V4TooMuchRequested.selector);
        }

        _assertNoTradeEffects(nativeBefore, projectBefore);
    }

    function testUniversalRouterNativeExactInputMultihop() public {
        uint128 grossNativeInput = 0.01 ether;
        uint256 bridgeBefore = bridgeToken.balanceOf(address(this));
        PathKey[] memory path = new PathKey[](2);
        path[0] = PathKey({
            intermediateCurrency: Currency.wrap(address(projectToken)),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: hook,
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
            CurrencyLibrary.ADDRESS_ZERO, path, grossNativeInput, 1, Currency.wrap(address(bridgeToken))
        );
        universalRouter.execute{ value: grossNativeInput }(commands, inputs, block.timestamp);

        assertGt(bridgeToken.balanceOf(address(this)), bridgeBefore);
        assertGt(hook.totalQuoteFeesAccrued(), 0);
        _assertRouterHasNoDust();
    }

    function testUniversalRouterNativeExactOutputMultihopPreservesPerHopHookData() public {
        uint128 netNativeOutput = 970_000;
        uint256 grossQuoteWitness = 1_000_000;
        uint256 nativeBefore = address(this).balance;
        PathKey[] memory path = new PathKey[](2);
        path[0] = PathKey({
            intermediateCurrency: Currency.wrap(address(bridgeToken)),
            fee: BRIDGE_LP_FEE_PIPS,
            tickSpacing: BRIDGE_TICK_SPACING,
            hooks: IHooks(address(0)),
            hookData: hex"1122"
        });
        path[1] = PathKey({
            intermediateCurrency: Currency.wrap(address(projectToken)),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: hook,
            hookData: abi.encode(grossQuoteWitness)
        });

        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutput(
            Currency.wrap(address(bridgeToken)), CurrencyLibrary.ADDRESS_ZERO, path, netNativeOutput, 1 ether
        );
        universalRouter.execute(commands, inputs, block.timestamp);

        assertEq(address(this).balance - nativeBefore, netNativeOutput);
        _assertFeeAccrual(30_000, 29_000, 1000);
        _assertRouterHasNoDust();
    }

    function _deployAndRegisterNativeHook() private returns (ProgrammableVolumeFeeHookV2 deployed) {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig({
                poolManager: IPoolManager(manager),
                currency0: CurrencyLibrary.ADDRESS_ZERO,
                currency1: Currency.wrap(address(projectToken)),
                lpFeePips: LP_FEE_PIPS,
                tickSpacing: TICK_SPACING,
                quoteCurrency: address(0),
                projectFeeOwner: makeAddr("nativeProjectFeeOwner"),
                selectedBuyHundredthsOfBip: SELECTED_THREE_PERCENT,
                selectedSellHundredthsOfBip: SELECTED_THREE_PERCENT,
                initialSqrtPriceX96: SQRT_PRICE_1_1
            });
        (, bytes32 userSalt) = _mineHook(config);
        evidenceHookUserSalt = userSalt;
        (deployed,,,) = hookFactory.deployAndRegister(userSalt, config);
    }

    function _mineHook(ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config)
        private
        view
        returns (address predicted, bytes32 userSalt)
    {
        for (uint256 candidate; candidate < 1_000_000; ++candidate) {
            userSalt = bytes32(candidate);
            (predicted,,) = hookFactory.predictHookAddress(userSalt, config);
            if ((uint160(predicted) & hookFactory.ALL_HOOK_MASK()) == hookFactory.REQUIRED_HOOK_FLAGS()) {
                return (predicted, userSalt);
            }
        }
        revert("valid native hook user salt not found");
    }

    function _initializeBridgePool(ModifyLiquidityParams memory liquidity) private {
        Currency project = Currency.wrap(address(projectToken));
        Currency bridge = Currency.wrap(address(bridgeToken));
        (Currency currency0, Currency currency1) =
            address(projectToken) < address(bridgeToken) ? (project, bridge) : (bridge, project);
        (PoolKey memory bridgeKey,) = initPool(
            currency0, currency1, IHooks(address(0)), BRIDGE_LP_FEE_PIPS, BRIDGE_TICK_SPACING, SQRT_PRICE_1_1
        );
        modifyLiquidityRouter.modifyLiquidity(bridgeKey, liquidity, ZERO_BYTES);
    }

    function _discoverExactOutputBuyWitness(uint128 projectOutput) private returns (uint256 grossQuoteWitness) {
        bytes memory wrappedFailure;
        try v4Quoter.quoteExactOutputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: hookKey,
                zeroForOne: _buyZeroForOne(),
                exactAmount: projectOutput,
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
        assertEq(target, address(hook), "unexpected exact-output failure target");
        assertEq(callbackSelector, IHooks.afterSwap.selector, "unexpected exact-output callback");
        (uint256 netQuoteInput,) = this.decodeInvalidWitness(innerReason);
        grossQuoteWitness = _findCurrentWitness(netQuoteInput);
    }

    function _findCurrentWitness(uint256 netQuoteAmount) private view returns (uint256 grossQuoteWitness) {
        uint256 estimate = (netQuoteAmount * 1_000_000 + 969_999) / 970_000;
        uint256 candidate = estimate > 8 ? estimate - 8 : 1;
        for (uint256 index; index < 32; ++index) {
            (bool valid,,,,,) = hook.quoteExactOutputWitness(netQuoteAmount, candidate, SELECTED_THREE_PERCENT);
            if (valid) return candidate;
            ++candidate;
        }
        revert("witness not found");
    }

    function _buyZeroForOne() private view returns (bool) {
        return hook.quoteIsCurrency0();
    }

    function _sellZeroForOne() private view returns (bool) {
        return !hook.quoteIsCurrency0();
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
        assertEq(hook.totalQuoteFeesAccrued(), total);
        assertEq(hook.projectFeesAccrued(), project);
        assertEq(hook.programmableFeesAccrued(), programmable);
        assertEq(total, project + programmable);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), total);
        assertGe(address(manager).balance, total);
    }

    function _assertRouterActionFailure(bytes memory reason, bytes4 expectedSelector) private pure {
        require(reason.length >= 4, "missing router action error");
        require(bytes4(reason) == expectedSelector, "unexpected router action error");
    }

    function _assertNoTradeEffects(uint256 nativeBefore, uint256 projectBefore) private view {
        assertEq(address(this).balance, nativeBefore, "native balance changed");
        assertEq(projectToken.balanceOf(address(this)), projectBefore, "project-token balance changed");
        assertEq(hook.totalQuoteFeesAccrued(), 0, "fee liability changed");
        assertEq(hook.projectFeesAccrued(), 0, "project fee liability changed");
        assertEq(hook.programmableFeesAccrued(), 0, "Programmable fee liability changed");
        assertEq(hook.projectFeeRemainder(), 0, "project remainder changed");
        assertEq(hook.programmableFeeRemainder(), 0, "Programmable remainder changed");
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), 0);
        _assertRouterHasNoDust();
    }

    function _assertRouterHasNoDust() private view {
        assertEq(projectToken.balanceOf(address(universalRouter)), 0);
        assertEq(bridgeToken.balanceOf(address(universalRouter)), 0);
        assertEq(address(universalRouter).balance, 0);
    }
}

/// @dev Project-owned runner subclasses expose only the exact tests declared by their manifest.
abstract contract ProgrammableTradeEvidenceHarnessV1 is ProgrammableVolumeFeeHookV2UniversalRouterNativeTest {
    using PoolIdLibrary for PoolKey;
    using TransientStateLibrary for IPoolManager;

    string internal constant TRADE_RESULTS_DIRECTORY = "test/vectors/trade-results/";

    struct EvidenceStateV1 {
        bytes32 approval;
        bytes32 wallet;
        bytes32 lockState;
        bytes32 application;
        uint256 nativeBalance;
        uint256 projectBalance;
    }

    function _evidenceDiscoverProfile() internal {
        string memory key = "standard-v4-profile";
        vm.serializeUint(key, "blockNumber", block.number);
        vm.serializeBytes32(key, "blockHash", blockhash(block.number - 1));
        vm.serializeUint(key, "blockTimestamp", block.timestamp);
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "currency0", Currency.unwrap(hookKey.currency0));
        vm.serializeAddress(key, "currency1", Currency.unwrap(hookKey.currency1));
        vm.serializeUint(key, "fee", hookKey.fee);
        vm.serializeInt(key, "tickSpacing", hookKey.tickSpacing);
        vm.serializeAddress(key, "hooks", address(hookKey.hooks));
        vm.serializeBytes(key, "hookCreationCode", type(ProgrammableVolumeFeeHookV2).creationCode);
        vm.serializeBytes32(key, "hookEffectiveSalt", hookFactory.effectiveSaltOf(address(hook)));
        vm.serializeBytes32(key, "hookRegistrationConfigHash", hookFactory.registrationConfigHashOf(address(hook)));
        vm.serializeBytes(key, "hookRuntimeCode", address(hook).code);
        vm.serializeBytes32(key, "hookRuntimeCodehash", address(hook).codehash);
        vm.serializeBytes32(key, "hookUserSalt", evidenceHookUserSalt);
        vm.serializeBytes(
            key, "hookConstructorArgs", abi.encode(IPoolManager(manager), address(hookFactory), address(0))
        );
        vm.serializeAddress(key, "hookFactory", address(hookFactory));
        vm.serializeBytes32(key, "hookFactoryCodehash", address(hookFactory).codehash);
        vm.serializeAddress(key, "poolManager", address(manager));
        vm.serializeBytes32(key, "poolManagerCodehash", address(manager).codehash);
        vm.serializeBytes32(key, "poolId", PoolId.unwrap(hookKey.toId()));
        vm.serializeAddress(key, "router", address(universalRouter));
        vm.serializeBytes32(key, "routerCodehash", address(universalRouter).codehash);
        vm.serializeAddress(key, "quoter", address(v4Quoter));
        vm.serializeBytes32(key, "quoterCodehash", address(v4Quoter).codehash);
        vm.serializeAddress(key, "permit2", permit2);
        vm.serializeBytes32(key, "permit2Codehash", permit2.codehash);
        string memory json = vm.serializeAddress(key, "testAccount", address(this));
        emit log_string(string.concat("PROGRAMMABLE_TRADE_DISCOVERY_V1:", json));
    }

    function _evidenceDiscoverQuote(uint256 mode) internal {
        uint256 specified =
            mode == 0 ? 1 ether : mode == 2 ? 0.01 ether : mode == 3 ? 970_000 : _fixedWitnessProjectOutput();
        bytes32 stateBefore = _evidenceQuoteStateDigest();
        uint256 quoted = _evidenceQuote(mode, specified);
        bytes32 stateAfter = _evidenceQuoteStateDigest();
        assertEq(stateAfter, stateBefore, "quote state changed");
        string memory key = "quote-observation";
        vm.serializeString(key, "amountQuoted", vm.toString(quoted));
        vm.serializeString(key, "amountSpecified", vm.toString(specified));
        vm.serializeBytes32(key, "stateAfterSha256", stateAfter);
        vm.serializeBytes32(key, "stateBeforeSha256", stateBefore);
        string memory json = vm.serializeBytes(key, "hookData", _evidenceHookData());
        emit log_string(string.concat("PROGRAMMABLE_TRADE_DISCOVERY_V1:", json));
    }

    function _evidenceDiscoverExecution(uint256 mode) internal {
        uint256 specified =
            mode == 0 ? 1 ether : mode == 2 ? 0.01 ether : mode == 3 ? 970_000 : _fixedWitnessProjectOutput();
        uint256 quoted = _evidenceQuote(mode, specified);
        uint256 guard = mode == 0 || mode == 2 ? quoted * 9950 / 10_000 : (quoted * 10_050 + 9999) / 10_000;
        uint256 deadline = block.timestamp + 60;
        (bytes memory commands, bytes[] memory inputs) = _evidencePlan(mode, uint128(specified), uint128(guard));
        bytes memory callData = abi.encodeWithSignature("execute(bytes,bytes[],uint256)", commands, inputs, deadline);
        EvidenceStateV1 memory beforeState = _evidenceState();
        bytes32 funding = sha256(
            abi.encode(
                mode,
                mode == 0 ? specified : mode == 1 ? guard : 0,
                beforeState.nativeBalance,
                beforeState.projectBalance
            )
        );
        (bool ok, bytes memory output) =
            address(universalRouter).call{ value: mode == 0 ? specified : mode == 1 ? guard : 0 }(callData);
        require(ok, "evidence execution failed");
        EvidenceStateV1 memory afterState = _evidenceState();
        uint256 amountIn = mode < 2
            ? beforeState.nativeBalance - afterState.nativeBalance
            : beforeState.projectBalance - afterState.projectBalance;
        uint256 amountOut = mode < 2
            ? afterState.projectBalance - beforeState.projectBalance
            : afterState.nativeBalance - beforeState.nativeBalance;
        uint256 refund = mode == 1 ? guard - amountIn : 0;
        if (mode == 1) assertGt(refund, 0, "native exact-output refund absent");
        assertEq(address(universalRouter).balance, 0, "router retained native dust");
        _evidenceEmitDiscoveryExecution(
            mode,
            specified,
            quoted,
            guard,
            deadline,
            amountIn,
            amountOut,
            refund,
            callData,
            output,
            funding,
            beforeState,
            afterState
        );
    }

    function _evidenceDiscoverRejection(uint256 scenario) internal {
        uint256 mode = scenario == 1 ? 1 : scenario == 2 ? 2 : 0;
        uint256 specified = mode == 0 ? 1 ether : mode == 2 ? 0.01 ether : _fixedWitnessProjectOutput();
        uint256 quoted = _evidenceQuote(mode, specified);
        uint256 guard = scenario == 1 ? quoted - 1 : quoted * 9950 / 10_000;
        uint256 deadline = scenario == 0 ? 1 : block.timestamp + 60;
        (bytes memory commands, bytes[] memory inputs) = _evidencePlan(mode, uint128(specified), uint128(guard));
        bytes memory callData = abi.encodeWithSignature("execute(bytes,bytes[],uint256)", commands, inputs, deadline);
        if (scenario == 2) IAllowanceTransfer(permit2).approve(address(projectToken), address(universalRouter), 0, 0);
        EvidenceStateV1 memory beforeState = _evidenceState();
        if (scenario == 0) vm.warp(deadline + 1);
        (bool ok, bytes memory reason) =
            address(universalRouter).call{ value: scenario == 1 ? guard : scenario == 0 ? specified : 0 }(callData);
        require(!ok && reason.length > 0, "evidence rejection absent");
        EvidenceStateV1 memory afterState = _evidenceState();
        _assertEvidenceNoEffects(beforeState.nativeBalance, beforeState.projectBalance);
        _evidenceEmitDiscoveryRejection(
            scenario, mode, specified, quoted, guard, deadline, callData, reason, beforeState, afterState
        );
    }

    function _evidenceQuoteAndEmit(uint256 mode, string memory fileName) internal {
        string memory json = _evidenceRead(fileName);
        uint256 specified = vm.parseJsonUint(json, ".context.request.amountSpecified");
        if (mode == 1) assertEq(_fixedWitnessProjectOutput(), specified, "typed exact-output witness mismatch");
        bytes32 stateBefore = _evidenceQuoteStateDigest();
        uint256 quoted = _evidenceQuote(mode, specified);
        bytes32 stateAfter = _evidenceQuoteStateDigest();
        _assertSha256Label(json, ".observation.stateBeforeSha256", stateBefore);
        _assertSha256Label(json, ".observation.stateAfterSha256", stateAfter);
        assertEq(stateAfter, stateBefore, "quote state changed");
        assertEq(quoted, vm.parseJsonUint(json, ".observation.amountQuoted"), "typed quote mismatch");
        _evidenceEmit(json);
    }

    function _evidenceExecuteAndEmit(uint256 mode, string memory fileName) internal {
        string memory json = _evidenceRead(fileName);
        uint128 specified = uint128(vm.parseJsonUint(json, ".context.request.amountSpecified"));
        uint128 guard = uint128(vm.parseJsonUint(json, ".observation.slippageGuardAmount"));
        EvidenceStateV1 memory beforeState = _evidenceState();
        bytes32 funding = sha256(
            abi.encode(
                mode,
                mode == 0 ? specified : mode == 1 ? guard : 0,
                beforeState.nativeBalance,
                beforeState.projectBalance
            )
        );
        (bytes memory commands, bytes[] memory inputs) = _evidencePlan(mode, specified, guard);
        universalRouter.execute{ value: mode == 0 ? specified : mode == 1 ? guard : 0 }(
            commands, inputs, block.timestamp + 60
        );
        EvidenceStateV1 memory afterState = _evidenceState();
        uint256 amountIn = mode < 2
            ? beforeState.nativeBalance - afterState.nativeBalance
            : beforeState.projectBalance - afterState.projectBalance;
        uint256 amountOut = mode < 2
            ? afterState.projectBalance - beforeState.projectBalance
            : afterState.nativeBalance - beforeState.nativeBalance;
        assertEq(amountIn, vm.parseJsonUint(json, ".observation.amountIn"), "typed input mismatch");
        assertEq(amountOut, vm.parseJsonUint(json, ".observation.amountOut"), "typed output mismatch");
        if (mode == 1) {
            assertGt(guard, amountIn, "native exact-output requires a positive refund");
            assertEq(vm.parseJsonUint(json, ".observation.refundAmount"), guard - amountIn, "typed refund mismatch");
        }
        assertEq(address(universalRouter).balance, 0, "router retained native dust");
        _evidenceAssertStateWitness(json, funding, beforeState, afterState);
        _evidenceEmit(json);
    }

    function _evidenceRejectSlippage(string memory fileName) internal {
        string memory json = _evidenceRead(fileName);
        uint128 output = uint128(vm.parseJsonUint(json, ".context.request.amountSpecified"));
        uint256 quoted = _quoteExactOutputSingle(hookKey, true, output, _evidenceHookData());
        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactOutputSingleNativeInput(
            hookKey, true, output, uint128(quoted - 1), _evidenceHookData(), Currency.wrap(address(projectToken))
        );
        EvidenceStateV1 memory beforeState = _evidenceState();
        try universalRouter.execute{ value: quoted - 1 }(commands, inputs, block.timestamp + 60) {
            fail();
        } catch { }
        EvidenceStateV1 memory afterState = _evidenceState();
        _assertEvidenceNoEffects(beforeState.nativeBalance, beforeState.projectBalance);
        _evidenceAssertStateWitness(
            json,
            sha256(abi.encode(uint256(1), quoted - 1, beforeState.nativeBalance, beforeState.projectBalance)),
            beforeState,
            afterState
        );
        _evidenceEmit(json);
    }

    function _evidenceRejectDeadline(string memory fileName) internal {
        string memory json = _evidenceRead(fileName);
        uint128 input = 1 ether;
        uint256 quoted = _quoteExactInputSingle(hookKey, true, input, _evidenceHookData());
        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactInputSingle(
            hookKey,
            true,
            input,
            uint128(quoted * 9950 / 10_000),
            _evidenceHookData(),
            Currency.wrap(address(0)),
            Currency.wrap(address(projectToken))
        );
        uint256 deadline = 1;
        EvidenceStateV1 memory beforeState = _evidenceState();
        vm.warp(deadline + 1);
        try universalRouter.execute{ value: input }(commands, inputs, deadline) {
            fail();
        } catch { }
        EvidenceStateV1 memory afterState = _evidenceState();
        _assertEvidenceNoEffects(beforeState.nativeBalance, beforeState.projectBalance);
        _evidenceAssertStateWitness(
            json,
            sha256(abi.encode(uint256(0), input, beforeState.nativeBalance, beforeState.projectBalance)),
            beforeState,
            afterState
        );
        _evidenceEmit(json);
    }

    function _evidenceRejectFunding(string memory fileName) internal {
        string memory json = _evidenceRead(fileName);
        uint128 input = 0.01 ether;
        uint256 quoted = _quoteExactInputSingle(hookKey, false, input, _evidenceHookData());
        (bytes memory commands, bytes[] memory inputs) = V4PlannerParityEncoder.exactInputSingle(
            hookKey,
            false,
            input,
            uint128(quoted * 9950 / 10_000),
            _evidenceHookData(),
            Currency.wrap(address(projectToken)),
            Currency.wrap(address(0))
        );
        IAllowanceTransfer(permit2).approve(address(projectToken), address(universalRouter), 0, 0);
        EvidenceStateV1 memory beforeState = _evidenceState();
        try universalRouter.execute(commands, inputs, block.timestamp + 60) {
            fail();
        } catch { }
        EvidenceStateV1 memory afterState = _evidenceState();
        _assertEvidenceNoEffects(beforeState.nativeBalance, beforeState.projectBalance);
        _evidenceAssertStateWitness(
            json,
            sha256(abi.encode(uint256(2), uint256(0), beforeState.nativeBalance, beforeState.projectBalance)),
            beforeState,
            afterState
        );
        _evidenceEmit(json);
    }

    function _evidencePlan(uint256 mode, uint128 specified, uint128 guard)
        private
        view
        returns (bytes memory commands, bytes[] memory inputs)
    {
        if (mode == 0 || mode == 2) {
            return V4PlannerParityEncoder.exactInputSingle(
                hookKey,
                mode == 0,
                specified,
                guard,
                _evidenceHookData(),
                mode == 0 ? Currency.wrap(address(0)) : Currency.wrap(address(projectToken)),
                mode == 0 ? Currency.wrap(address(projectToken)) : Currency.wrap(address(0))
            );
        }
        if (mode == 1) {
            return V4PlannerParityEncoder.exactOutputSingleNativeInput(
                hookKey, true, specified, guard, _evidenceHookData(), Currency.wrap(address(projectToken))
            );
        }
        return V4PlannerParityEncoder.exactOutputSingle(
            hookKey,
            false,
            specified,
            guard,
            _evidenceHookData(),
            Currency.wrap(address(projectToken)),
            Currency.wrap(address(0))
        );
    }

    function _evidenceState() private view returns (EvidenceStateV1 memory state) {
        state.approval = _evidenceApprovalDigest();
        state.wallet = _evidenceWalletDigest();
        state.lockState = _evidenceLockDigest();
        state.application = _evidenceApplicationDigest();
        state.nativeBalance = address(this).balance;
        state.projectBalance = projectToken.balanceOf(address(this));
    }

    function _evidenceApprovalDigest() private view returns (bytes32) {
        (uint160 amount, uint48 expiration, uint48 nonce) =
            IAllowanceTransfer(permit2).allowance(address(this), address(projectToken), address(universalRouter));
        return sha256(abi.encode(projectToken.allowance(address(this), permit2), amount, expiration, nonce));
    }

    function _evidenceWalletDigest() private view returns (bytes32) {
        return sha256(abi.encode(address(this).balance, projectToken.balanceOf(address(this))));
    }

    function _evidenceLockDigest() private view returns (bytes32) {
        return sha256(
            abi.encode(
                manager.currencyDelta(address(this), hookKey.currency0),
                manager.currencyDelta(address(this), hookKey.currency1),
                address(universalRouter).balance,
                projectToken.balanceOf(address(universalRouter))
            )
        );
    }

    function _evidenceApplicationDigest() private view returns (bytes32) {
        return sha256(
            abi.encode(
                hook.totalQuoteFeesAccrued(),
                hook.projectFeesAccrued(),
                hook.programmableFeesAccrued(),
                hook.projectFeeRemainder(),
                hook.programmableFeeRemainder()
            )
        );
    }

    function _evidenceQuoteStateDigest() private view returns (bytes32) {
        EvidenceStateV1 memory state = _evidenceState();
        return sha256(abi.encode(state.approval, state.wallet, state.lockState, state.application));
    }

    function _evidenceEmitDiscoveryExecution(
        uint256 mode,
        uint256 specified,
        uint256 quoted,
        uint256 guard,
        uint256 deadline,
        uint256 amountIn,
        uint256 amountOut,
        uint256 refund,
        bytes memory callData,
        bytes memory output,
        bytes32 funding,
        EvidenceStateV1 memory beforeState,
        EvidenceStateV1 memory afterState
    ) private {
        string memory key = "execution-observation";
        vm.serializeString(key, "amountIn", vm.toString(amountIn));
        vm.serializeString(key, "amountOut", vm.toString(amountOut));
        vm.serializeString(key, "amountQuoted", vm.toString(quoted));
        vm.serializeString(key, "amountSpecified", vm.toString(specified));
        vm.serializeBytes32(key, "applicationAfterSha256", afterState.application);
        vm.serializeBytes32(key, "applicationBeforeSha256", beforeState.application);
        vm.serializeBytes32(key, "approvalAfterSha256", afterState.approval);
        vm.serializeBytes32(key, "approvalBeforeSha256", beforeState.approval);
        vm.serializeBytes(key, "callData", callData);
        vm.serializeString(key, "deadline", vm.toString(deadline));
        vm.serializeString(key, "dustAmount", vm.toString(address(universalRouter).balance));
        vm.serializeBytes32(key, "fundingAfterSha256", funding);
        vm.serializeBytes32(key, "fundingBeforeSha256", funding);
        vm.serializeBytes32(key, "lockAfterSha256", afterState.lockState);
        vm.serializeBytes32(key, "lockBeforeSha256", beforeState.lockState);
        vm.serializeUint(key, "mode", mode);
        vm.serializeString(key, "nativeAfter", vm.toString(afterState.nativeBalance));
        vm.serializeString(key, "nativeBefore", vm.toString(beforeState.nativeBalance));
        vm.serializeString(key, "projectAfter", vm.toString(afterState.projectBalance));
        vm.serializeString(key, "projectBefore", vm.toString(beforeState.projectBalance));
        vm.serializeString(key, "refundAmount", vm.toString(refund));
        vm.serializeBytes(key, "returnData", output);
        vm.serializeString(key, "slippageGuardAmount", vm.toString(guard));
        vm.serializeBytes32(key, "walletAfterSha256", afterState.wallet);
        string memory json = vm.serializeBytes32(key, "walletBeforeSha256", beforeState.wallet);
        emit log_string(string.concat("PROGRAMMABLE_TRADE_DISCOVERY_V1:", json));
    }

    function _evidenceEmitDiscoveryRejection(
        uint256 scenario,
        uint256 mode,
        uint256 specified,
        uint256 quoted,
        uint256 guard,
        uint256 deadline,
        bytes memory callData,
        bytes memory reason,
        EvidenceStateV1 memory beforeState,
        EvidenceStateV1 memory afterState
    ) private {
        string memory key = "rejection-observation";
        vm.serializeString(key, "amountQuoted", vm.toString(quoted));
        vm.serializeString(key, "amountSpecified", vm.toString(specified));
        vm.serializeBytes32(key, "applicationAfterSha256", afterState.application);
        vm.serializeBytes32(key, "applicationBeforeSha256", beforeState.application);
        vm.serializeBytes32(key, "approvalAfterSha256", afterState.approval);
        vm.serializeBytes32(key, "approvalBeforeSha256", beforeState.approval);
        vm.serializeBytes(key, "callData", callData);
        vm.serializeString(key, "deadline", vm.toString(deadline));
        vm.serializeBytes32(
            key,
            "fundingAfterSha256",
            sha256(
                abi.encode(
                    mode,
                    scenario == 1 ? guard : scenario == 0 ? specified : 0,
                    beforeState.nativeBalance,
                    beforeState.projectBalance
                )
            )
        );
        vm.serializeBytes32(
            key,
            "fundingBeforeSha256",
            sha256(
                abi.encode(
                    mode,
                    scenario == 1 ? guard : scenario == 0 ? specified : 0,
                    beforeState.nativeBalance,
                    beforeState.projectBalance
                )
            )
        );
        vm.serializeBytes32(key, "lockAfterSha256", afterState.lockState);
        vm.serializeBytes32(key, "lockBeforeSha256", beforeState.lockState);
        vm.serializeUint(key, "mode", mode);
        vm.serializeString(key, "nativeAfter", vm.toString(afterState.nativeBalance));
        vm.serializeString(key, "nativeBefore", vm.toString(beforeState.nativeBalance));
        vm.serializeString(key, "projectAfter", vm.toString(afterState.projectBalance));
        vm.serializeString(key, "projectBefore", vm.toString(beforeState.projectBalance));
        vm.serializeBytes(key, "revertData", reason);
        vm.serializeUint(key, "scenario", scenario);
        vm.serializeString(key, "slippageGuardAmount", vm.toString(guard));
        vm.serializeBytes32(key, "walletAfterSha256", afterState.wallet);
        string memory json = vm.serializeBytes32(key, "walletBeforeSha256", beforeState.wallet);
        emit log_string(string.concat("PROGRAMMABLE_TRADE_DISCOVERY_V1:", json));
    }

    function _evidenceAssertStateWitness(
        string memory json,
        bytes32 funding,
        EvidenceStateV1 memory beforeState,
        EvidenceStateV1 memory afterState
    ) private {
        _assertSha256Label(json, ".observation.stateWitness.approvalBeforeSha256", beforeState.approval);
        _assertSha256Label(json, ".observation.stateWitness.approvalAfterSha256", afterState.approval);
        _assertSha256Label(json, ".observation.stateWitness.fundingBeforeSha256", funding);
        _assertSha256Label(json, ".observation.stateWitness.fundingAfterSha256", funding);
        _assertSha256Label(json, ".observation.stateWitness.walletBeforeSha256", beforeState.wallet);
        _assertSha256Label(json, ".observation.stateWitness.walletAfterSha256", afterState.wallet);
        _assertSha256Label(json, ".observation.stateWitness.lockBeforeSha256", beforeState.lockState);
        _assertSha256Label(json, ".observation.stateWitness.lockAfterSha256", afterState.lockState);
        _assertSha256Label(json, ".observation.stateWitness.applicationBeforeSha256", beforeState.application);
        _assertSha256Label(json, ".observation.stateWitness.applicationAfterSha256", afterState.application);
    }

    function _assertSha256Label(string memory json, string memory jsonPath, bytes32 digest) private {
        bytes memory declared = bytes(vm.parseJsonString(json, jsonPath));
        bytes memory actual = bytes(vm.toString(digest));
        require(declared.length == 71 && actual.length == 66, "invalid sha256 label");
        require(
            declared[0] == "s" && declared[1] == "h" && declared[2] == "a" && declared[3] == "2" && declared[4] == "5"
                && declared[5] == "6" && declared[6] == ":",
            "invalid sha256 prefix"
        );
        for (uint256 index; index < 64; ++index) {
            require(declared[index + 7] == actual[index + 2], "sha256 mismatch");
        }
    }

    function _evidenceQuote(uint256 mode, uint256 specified) private returns (uint256) {
        if (mode == 0 || mode == 2) {
            return _quoteExactInputSingle(hookKey, mode == 0, uint128(specified), _evidenceHookData());
        }
        return _quoteExactOutputSingle(hookKey, mode == 1, uint128(specified), _evidenceHookData());
    }

    function _fixedWitnessProjectOutput() private returns (uint256) {
        uint256 low = 1;
        uint256 high = 2_000_000;
        for (uint256 index; index < 32 && low <= high; ++index) {
            uint256 candidate = (low + high) / 2;
            try v4Quoter.quoteExactOutputSingle(
                IV4Quoter.QuoteExactSingleParams({
                    poolKey: hookKey, zeroForOne: true, exactAmount: uint128(candidate), hookData: _evidenceHookData()
                })
            ) returns (
                uint256 amountIn, uint256
            ) {
                if (amountIn == 1_000_000) return candidate;
            } catch (bytes memory reason) {
                bytes memory wrapped = this.decodeUnexpectedQuoteFailure(reason);
                (,, bytes memory inner,) = this.decodeWrappedQuoteFailure(wrapped);
                (uint256 net,) = this.decodeInvalidWitness(inner);
                if (net < 970_000) low = candidate + 1;
                else high = candidate - 1;
                continue;
            }
            break;
        }
        revert("fixed witness output not found");
    }

    function _assertEvidenceNoEffects(uint256 nativeBefore, uint256 tokenBefore) private view {
        assertEq(address(this).balance, nativeBefore, "rejected route moved native currency");
        assertEq(projectToken.balanceOf(address(this)), tokenBefore, "rejected route moved project token");
        assertEq(address(universalRouter).balance, 0, "rejected route left router dust");
    }

    function _evidenceHookData() private pure returns (bytes memory) {
        return abi.encode(uint256(1_000_000));
    }

    function _evidenceRead(string memory fileName) private view returns (string memory) {
        return vm.readFile(string.concat(TRADE_RESULTS_DIRECTORY, fileName));
    }

    function _evidenceEmit(string memory json) private {
        emit log_string(string.concat("PROGRAMMABLE_TRADE_RESULT_V1:", json));
    }
}
