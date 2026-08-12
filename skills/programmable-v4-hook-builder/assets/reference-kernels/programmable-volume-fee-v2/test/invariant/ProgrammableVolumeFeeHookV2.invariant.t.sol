// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { Test } from "forge-std/Test.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import { ProgrammableVolumeFeeHookV2 } from "../../src/ProgrammableVolumeFeeHookV2.sol";
import { MockReferenceToken } from "../MockReferenceToken.sol";
import { ProgrammableVolumeFeeHookV2Erc20Fixture } from "../helpers/ProgrammableVolumeFeeHookV2Erc20Fixture.sol";

contract ProgrammableVolumeFeeHookV2Handler is Test {
    using SafeCast for uint256;
    using SafeCast for int256;

    uint256 internal constant RATE_DENOMINATOR = 1_000_000;
    uint256 internal constant PROGRAMMABLE_RATE = 1000;
    uint256 internal constant PROJECT_RATE = 29_000;
    uint32 internal constant SELECTED_THREE_PERCENT = 30_000;
    address internal constant PROJECT_RECIPIENT = address(0xBEEF);
    address internal constant PROGRAMMABLE_RECIPIENT = address(0xCAFE);
    address internal constant ATTACKER = address(0xBAD);

    ProgrammableVolumeFeeHookV2 public immutable hook;
    IPoolManager public immutable manager;
    PoolSwapTest public immutable router;
    MockReferenceToken public immutable quoteToken;
    MockReferenceToken public immutable launchedToken;
    address public immutable projectFeeOwner;
    PoolKey internal key;
    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    uint256 public cumulativeGrossQuote;
    uint256 public projectClaimed;
    uint256 public programmableClaimed;
    uint256 public successfulSwaps;
    uint256 public accountingViolations;
    uint256 public claimIsolationViolations;
    uint256 public staleWitnessViolations;

    constructor(
        ProgrammableVolumeFeeHookV2 hook_,
        IPoolManager manager_,
        PoolSwapTest router_,
        PoolKey memory key_,
        MockReferenceToken quoteToken_,
        MockReferenceToken launchedToken_,
        address projectFeeOwner_
    ) {
        hook = hook_;
        manager = manager_;
        router = router_;
        key = key_;
        quoteToken = quoteToken_;
        launchedToken = launchedToken_;
        projectFeeOwner = projectFeeOwner_;
        quoteToken_.approve(address(router_), type(uint256).max);
        launchedToken_.approve(address(router_), type(uint256).max);
    }

    function exactInputBuy(uint96 rawGrossQuote) external {
        uint256 grossQuote = bound(uint256(rawGrossQuote), 1000, 100 ether);
        uint256 totalBefore = hook.totalQuoteFeesAccrued();
        bool zeroForOne = _buyZeroForOne();
        try router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -grossQuote.toInt256(),
                sqrtPriceLimitX96: _priceLimit(zeroForOne)
            }),
            settings,
            ""
        ) returns (
            BalanceDelta delta
        ) {
            uint256 totalAfter = hook.totalQuoteFeesAccrued();
            if (totalAfter < totalBefore || _absolute(_quoteDelta(delta)) != grossQuote) {
                ++accountingViolations;
                return;
            }
            _recordGross(grossQuote);
        } catch { }
    }

    function exactInputSell(uint96 rawLaunchedInput) external {
        uint256 launchedInput = bound(uint256(rawLaunchedInput), 1000, 100 ether);
        uint256 totalBefore = hook.totalQuoteFeesAccrued();
        bool zeroForOne = _sellZeroForOne();
        try router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -launchedInput.toInt256(),
                sqrtPriceLimitX96: _priceLimit(zeroForOne)
            }),
            settings,
            ""
        ) returns (
            BalanceDelta delta
        ) {
            uint256 totalAfter = hook.totalQuoteFeesAccrued();
            int256 netQuoteOutput = _quoteDelta(delta);
            if (totalAfter < totalBefore || netQuoteOutput < 0) {
                ++accountingViolations;
                return;
            }
            _recordGross(netQuoteOutput.toUint256() + (totalAfter - totalBefore));
        } catch { }
    }

    function exactOutputBuy(uint96 rawLaunchedOutput) external {
        uint256 launchedOutput = bound(uint256(rawLaunchedOutput), 1000, 10 ether);
        bool zeroForOne = _buyZeroForOne();
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: launchedOutput.toInt256(),
            sqrtPriceLimitX96: _priceLimit(zeroForOne)
        });
        uint256 netQuoteInput;
        try router.swap(key, params, settings, abi.encode(uint256(1))) returns (BalanceDelta delta) {
            if (_absolute(_quoteDelta(delta)) != 1) ++accountingViolations;
            _recordGross(1);
            return;
        } catch (bytes memory reason) {
            try this.decodeExecutedNetQuote(reason) returns (uint256 decodedNetQuoteInput) {
                netQuoteInput = decodedNetQuoteInput;
            } catch {
                return;
            }
        }
        (bool found, uint256 grossQuoteWitness) = _findWitness(netQuoteInput);
        if (!found) return;
        uint256 totalBefore = hook.totalQuoteFeesAccrued();
        try router.swap(key, params, settings, abi.encode(grossQuoteWitness)) returns (BalanceDelta delta) {
            uint256 totalAfter = hook.totalQuoteFeesAccrued();
            if (totalAfter < totalBefore || _absolute(_quoteDelta(delta)) != grossQuoteWitness) {
                ++accountingViolations;
                return;
            }
            _recordGross(grossQuoteWitness);
        } catch { }
    }

    function exactOutputSell(uint96 rawNetQuoteOutput) external {
        uint256 netQuoteOutput = bound(uint256(rawNetQuoteOutput), 1, 10 ether);
        (bool found, uint256 grossQuoteWitness) = _findWitness(netQuoteOutput);
        if (!found) return;
        uint256 totalBefore = hook.totalQuoteFeesAccrued();
        bool zeroForOne = _sellZeroForOne();
        try router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: netQuoteOutput.toInt256(),
                sqrtPriceLimitX96: _priceLimit(zeroForOne)
            }),
            settings,
            abi.encode(grossQuoteWitness)
        ) returns (
            BalanceDelta delta
        ) {
            uint256 totalAfter = hook.totalQuoteFeesAccrued();
            if (totalAfter < totalBefore || _quoteDelta(delta) != netQuoteOutput.toInt256()) {
                ++accountingViolations;
                return;
            }
            _recordGross(grossQuoteWitness);
        } catch { }
    }

    function claimProject() external {
        uint256 amountBefore = hook.projectFeesAccrued();
        uint256 otherBefore = hook.programmableFeesAccrued();
        uint256 totalBefore = hook.totalQuoteFeesAccrued();
        uint256 projectRemainderBefore = hook.projectFeeRemainder();
        uint256 programmableRemainderBefore = hook.programmableFeeRemainder();
        uint256 recipientBefore = quoteToken.balanceOf(PROJECT_RECIPIENT);
        vm.prank(projectFeeOwner);
        try hook.claimProjectFees(PROJECT_RECIPIENT) returns (uint256 amount) {
            if (
                amount != amountBefore || amount == 0 || hook.programmableFeesAccrued() != otherBefore
                    || hook.totalQuoteFeesAccrued() + amount != totalBefore
                    || hook.projectFeeRemainder() != projectRemainderBefore
                    || hook.programmableFeeRemainder() != programmableRemainderBefore
                    || quoteToken.balanceOf(PROJECT_RECIPIENT) != recipientBefore + amount
            ) ++claimIsolationViolations;
            projectClaimed += amount;
        } catch {
            if (amountBefore != 0) ++claimIsolationViolations;
        }
    }

    function claimProgrammable() external {
        uint256 amountBefore = hook.programmableFeesAccrued();
        uint256 otherBefore = hook.projectFeesAccrued();
        uint256 totalBefore = hook.totalQuoteFeesAccrued();
        uint256 projectRemainderBefore = hook.projectFeeRemainder();
        uint256 programmableRemainderBefore = hook.programmableFeeRemainder();
        uint256 recipientBefore = quoteToken.balanceOf(PROGRAMMABLE_RECIPIENT);
        vm.prank(hook.PROGRAMMABLE_FEE_OWNER());
        try hook.claimProgrammableFees(PROGRAMMABLE_RECIPIENT) returns (uint256 amount) {
            if (
                amount != amountBefore || amount == 0 || hook.projectFeesAccrued() != otherBefore
                    || hook.totalQuoteFeesAccrued() + amount != totalBefore
                    || hook.projectFeeRemainder() != projectRemainderBefore
                    || hook.programmableFeeRemainder() != programmableRemainderBefore
                    || quoteToken.balanceOf(PROGRAMMABLE_RECIPIENT) != recipientBefore + amount
            ) ++claimIsolationViolations;
            programmableClaimed += amount;
        } catch {
            if (amountBefore != 0) ++claimIsolationViolations;
        }
    }

    function unauthorizedClaims() external {
        vm.prank(ATTACKER);
        try hook.claimProjectFees(ATTACKER) returns (uint256) {
            ++claimIsolationViolations;
        } catch { }
        vm.prank(ATTACKER);
        try hook.claimProgrammableFees(ATTACKER) returns (uint256) {
            ++claimIsolationViolations;
        } catch { }
        vm.prank(hook.PROGRAMMABLE_FEE_OWNER());
        try hook.claimProjectFees(ATTACKER) returns (uint256) {
            ++claimIsolationViolations;
        } catch { }
        vm.prank(projectFeeOwner);
        try hook.claimProgrammableFees(ATTACKER) returns (uint256) {
            ++claimIsolationViolations;
        } catch { }
    }

    function staleWitnessAttempt(uint32 rawNetQuoteOutput, uint32 rawFrontRunGross) external {
        uint256 netQuoteOutput = bound(uint256(rawNetQuoteOutput), 1, 100_000);
        (bool found, uint256 oldWitness) = _findWitness(netQuoteOutput);
        if (!found) return;

        uint256 frontRunGross = bound(uint256(rawFrontRunGross), 999, 1999);
        uint256 totalBeforeFrontRun = hook.totalQuoteFeesAccrued();
        bool buyZeroForOne = _buyZeroForOne();
        try router.swap(
            key,
            SwapParams({
                zeroForOne: buyZeroForOne,
                amountSpecified: -frontRunGross.toInt256(),
                sqrtPriceLimitX96: _priceLimit(buyZeroForOne)
            }),
            settings,
            ""
        ) returns (
            BalanceDelta delta
        ) {
            if (hook.totalQuoteFeesAccrued() < totalBeforeFrontRun || _absolute(_quoteDelta(delta)) != frontRunGross) {
                ++accountingViolations;
                return;
            }
            _recordGross(frontRunGross);
        } catch {
            return;
        }

        (bool stillValid,,,,,) = hook.quoteExactOutputWitness(netQuoteOutput, oldWitness, SELECTED_THREE_PERCENT);
        if (stillValid) return;
        uint256 totalBefore = hook.totalQuoteFeesAccrued();
        uint256 projectBefore = hook.projectFeesAccrued();
        uint256 programmableBefore = hook.programmableFeesAccrued();
        uint256 projectRemainderBefore = hook.projectFeeRemainder();
        uint256 programmableRemainderBefore = hook.programmableFeeRemainder();
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        uint256 launchedBefore = launchedToken.balanceOf(address(this));
        bool sellZeroForOne = _sellZeroForOne();
        try router.swap(
            key,
            SwapParams({
                zeroForOne: sellZeroForOne,
                amountSpecified: netQuoteOutput.toInt256(),
                sqrtPriceLimitX96: _priceLimit(sellZeroForOne)
            }),
            settings,
            abi.encode(oldWitness)
        ) returns (
            BalanceDelta
        ) {
            ++staleWitnessViolations;
        } catch {
            if (
                hook.totalQuoteFeesAccrued() != totalBefore || hook.projectFeesAccrued() != projectBefore
                    || hook.programmableFeesAccrued() != programmableBefore
                    || hook.projectFeeRemainder() != projectRemainderBefore
                    || hook.programmableFeeRemainder() != programmableRemainderBefore
                    || quoteToken.balanceOf(address(this)) != quoteBefore
                    || launchedToken.balanceOf(address(this)) != launchedBefore
            ) ++staleWitnessViolations;
        }
    }

    function decodeExecutedNetQuote(bytes calldata reason) external view returns (uint256 netQuoteAmount) {
        require(reason.length >= 4 && bytes4(reason[:4]) == CustomRevert.WrappedError.selector, "not WrappedError");
        (address target, bytes4 callbackSelector, bytes memory innerReason,) =
            abi.decode(reason[4:], (address, bytes4, bytes, bytes));
        require(target == address(hook) && callbackSelector == IHooks.afterSwap.selector, "wrong callback");
        bytes4 innerSelector;
        assembly ("memory-safe") {
            innerSelector := mload(add(innerReason, 0x20))
            netQuoteAmount := mload(add(innerReason, 0x24))
        }
        require(
            innerReason.length == 68 && innerSelector == ProgrammableVolumeFeeHookV2.InvalidExactOutputWitness.selector,
            "not witness error"
        );
    }

    function _recordGross(uint256 grossQuote) private {
        cumulativeGrossQuote += grossQuote;
        ++successfulSwaps;
    }

    function _findWitness(uint256 netQuoteAmount) private view returns (bool found, uint256 grossQuoteWitness) {
        uint256 estimate = (netQuoteAmount * RATE_DENOMINATOR + 969_999) / 970_000;
        uint256 candidate = estimate > 16 ? estimate - 16 : 1;
        for (uint256 index; index < 64; ++index) {
            (bool valid,,,,,) = hook.quoteExactOutputWitness(netQuoteAmount, candidate, SELECTED_THREE_PERCENT);
            if (valid) return (true, candidate);
            ++candidate;
        }
    }

    function _buyZeroForOne() private view returns (bool) {
        return hook.quoteIsCurrency0();
    }

    function _sellZeroForOne() private view returns (bool) {
        return !hook.quoteIsCurrency0();
    }

    function _priceLimit(bool zeroForOne) private pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    function _quoteDelta(BalanceDelta delta) private view returns (int256) {
        return hook.quoteIsCurrency0() ? int256(delta.amount0()) : int256(delta.amount1());
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return SignedMath.abs(value);
    }
}

contract ProgrammableVolumeFeeHookV2InvariantTest is ProgrammableVolumeFeeHookV2Erc20Fixture {
    uint256 internal constant RATE_DENOMINATOR = 1_000_000;
    uint256 internal constant PROGRAMMABLE_RATE = 1000;
    uint256 internal constant PROJECT_RATE = 29_000;

    ProgrammableVolumeFeeHookV2Handler internal handler;

    function setUp() public {
        _setUpErc20Pool();
        handler = new ProgrammableVolumeFeeHookV2Handler(
            erc20Hook, manager, swapRouter, erc20HookKey, quoteToken, launchedToken, erc20ProjectFeeOwner
        );
        assertTrue(quoteToken.transfer(address(handler), 1_000_000 ether));
        assertTrue(launchedToken.transfer(address(handler), 1_000_000 ether));

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.exactInputBuy.selector;
        selectors[1] = handler.exactInputSell.selector;
        selectors[2] = handler.exactOutputBuy.selector;
        selectors[3] = handler.exactOutputSell.selector;
        selectors[4] = handler.claimProject.selector;
        selectors[5] = handler.claimProgrammable.selector;
        selectors[6] = handler.unauthorizedClaims.selector;
        selectors[7] = handler.staleWitnessAttempt.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function invariant_LifetimeConservationAndRemaindersMatchExecutedGross() public view {
        uint256 grossQuote = handler.cumulativeGrossQuote();
        uint256 lifetimeProject = erc20Hook.projectFeesAccrued() + handler.projectClaimed();
        uint256 lifetimeProgrammable = erc20Hook.programmableFeesAccrued() + handler.programmableClaimed();

        assertEq(lifetimeProgrammable, grossQuote * PROGRAMMABLE_RATE / RATE_DENOMINATOR);
        assertEq(lifetimeProject, grossQuote * PROJECT_RATE / RATE_DENOMINATOR);
        assertEq(erc20Hook.programmableFeeRemainder(), grossQuote * PROGRAMMABLE_RATE % RATE_DENOMINATOR);
        assertEq(erc20Hook.projectFeeRemainder(), grossQuote * PROJECT_RATE % RATE_DENOMINATOR);
        assertEq(
            lifetimeProject + lifetimeProgrammable,
            erc20Hook.totalQuoteFeesAccrued() + handler.projectClaimed() + handler.programmableClaimed()
        );
    }

    function invariant_CurrentLiabilityIsSegregatedAndFullyFunded() public view {
        uint256 projectLiability = erc20Hook.projectFeesAccrued();
        uint256 programmableLiability = erc20Hook.programmableFeesAccrued();
        uint256 totalLiability = erc20Hook.totalQuoteFeesAccrued();
        uint256 claimTokens = manager.balanceOf(address(erc20Hook), Currency.wrap(address(quoteToken)).toId());

        assertEq(totalLiability, projectLiability + programmableLiability);
        assertEq(claimTokens, totalLiability);
        assertGe(quoteToken.balanceOf(address(manager)), totalLiability);
        assertEq(erc20Hook.claimableLiability(erc20PoolId, address(quoteToken), erc20ProjectFeeOwner), projectLiability);
        assertEq(
            erc20Hook.claimableLiability(erc20PoolId, address(quoteToken), erc20Hook.PROGRAMMABLE_FEE_OWNER()),
            programmableLiability
        );
    }

    function invariant_ClaimsAreIsolatedAndStaleWitnessesCannotMutateState() public view {
        assertEq(handler.accountingViolations(), 0);
        assertEq(handler.claimIsolationViolations(), 0);
        assertEq(handler.staleWitnessViolations(), 0);
        assertLt(erc20Hook.projectFeeRemainder(), RATE_DENOMINATOR);
        assertLt(erc20Hook.programmableFeeRemainder(), RATE_DENOMINATOR);
    }
}
