// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import { LiquidityGrowthFullRangeLaunchV2 } from "../src/LiquidityGrowthFullRangeLaunchV2.sol";
import { LiquidityGrowthFullRangeV2Fixture } from "./utils/LiquidityGrowthFullRangeV2Fixture.sol";

/// @notice Deep V2 regression for every v4 exact-input/exact-output direction.
contract LiquidityGrowthFullRangeV2FeeAccountingTest is LiquidityGrowthFullRangeV2Fixture {
    uint16 private constant TOTAL_SWAP_FEE_BPS = 100;
    uint16 private constant CREATOR_FEE_BPS = 90;
    uint16 private constant PROGRAMMABLE_FEE_BPS = 10;
    uint256 private constant BASIS_POINTS = 10_000;

    PoolSwapTest.TestSettings private settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function test_v2FeeDisclosureIsExactlyNinetyTenWithNoTransferTaxOrLpFee() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,,) =
            _launchV2Fixture(keccak256("v2-fee-disclosure"));

        (
            uint16 buyFee,
            uint16 sellFee,
            uint16 buyCreatorFee,
            uint16 sellCreatorFee,
            uint16 launcherFee,
            uint16 transferTax,
            uint24 lpFee,
            address rewardVault
        ) = hook.feeDisclosure(result.poolId);

        assertEq(buyFee, TOTAL_SWAP_FEE_BPS);
        assertEq(sellFee, TOTAL_SWAP_FEE_BPS);
        assertEq(buyCreatorFee, CREATOR_FEE_BPS);
        assertEq(sellCreatorFee, CREATOR_FEE_BPS);
        assertEq(launcherFee, PROGRAMMABLE_FEE_BPS);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(rewardVault, result.upstreamRewardVault);
    }

    function test_v2ExactInputBuyAccruesExactNinetyTenSplit() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result, PoolKey memory key,) =
            _launchV2Fixture(keccak256("v2-exact-input-buy"));
        (uint256 creatorBefore, uint256 programmableBefore) = _feeSnapshot(result.poolId);

        uint256 grossNativeInput = 0.1 ether;
        BalanceDelta delta = _swap(key, true, -int256(grossNativeInput), grossNativeInput);
        (uint256 creatorAfter, uint256 programmableAfter) = _feeSnapshot(result.poolId);
        uint256 creatorIncrease = creatorAfter - creatorBefore;
        uint256 programmableIncrease = programmableAfter - programmableBefore;

        assertEq(uint256(-int256(delta.amount0())), grossNativeInput);
        _assertGrossSplit(grossNativeInput, creatorIncrease, programmableIncrease);
    }

    function test_v2ExactOutputBuyAccruesExactNinetyTenSplit() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result, PoolKey memory key,) =
            _launchV2Fixture(keccak256("v2-exact-output-buy"));
        (uint256 creatorBefore, uint256 programmableBefore) = _feeSnapshot(result.poolId);

        uint256 tokenOutput = 10_000 ether;
        BalanceDelta delta = _swap(key, true, int256(tokenOutput), 1 ether);
        (uint256 creatorAfter, uint256 programmableAfter) = _feeSnapshot(result.poolId);
        uint256 creatorIncrease = creatorAfter - creatorBefore;
        uint256 programmableIncrease = programmableAfter - programmableBefore;
        uint256 grossNativeInput = uint256(-int256(delta.amount0()));
        uint256 netNativeInput = grossNativeInput - creatorIncrease - programmableIncrease;
        (uint256 expectedCreator, uint256 expectedProgrammable) =
            hook.quoteExactOutputFees(netNativeInput, TOTAL_SWAP_FEE_BPS);

        assertEq(uint256(int256(delta.amount1())), tokenOutput);
        assertEq(creatorIncrease, expectedCreator);
        assertEq(programmableIncrease, expectedProgrammable);
        assertEq(creatorIncrease + programmableIncrease, grossNativeInput - netNativeInput);
    }

    function test_v2ExactInputSellAccruesExactNinetyTenSplit() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result, PoolKey memory key,) =
            _launchV2Fixture(keccak256("v2-exact-input-sell"));
        IERC20 token = IERC20(result.token);
        uint256 tokenInput = 100_000 ether;
        vm.prank(creator);
        assertTrue(token.transfer(address(this), tokenInput));
        token.approve(address(swapRouter), tokenInput);
        (uint256 creatorBefore, uint256 programmableBefore) = _feeSnapshot(result.poolId);

        BalanceDelta delta = _swap(key, false, -int256(tokenInput), 0);
        (uint256 creatorAfter, uint256 programmableAfter) = _feeSnapshot(result.poolId);
        uint256 creatorIncrease = creatorAfter - creatorBefore;
        uint256 programmableIncrease = programmableAfter - programmableBefore;
        uint256 grossNativeOutput = uint256(int256(delta.amount0())) + creatorIncrease + programmableIncrease;

        assertEq(uint256(-int256(delta.amount1())), tokenInput);
        _assertGrossSplit(grossNativeOutput, creatorIncrease, programmableIncrease);
    }

    function test_v2ExactOutputSellAccruesExactNinetyTenSplit() public {
        (LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result, PoolKey memory key,) =
            _launchV2Fixture(keccak256("v2-exact-output-sell"));
        IERC20 token = IERC20(result.token);
        uint256 creatorTokenBalance = token.balanceOf(creator);
        vm.prank(creator);
        assertTrue(token.transfer(address(this), creatorTokenBalance));
        token.approve(address(swapRouter), creatorTokenBalance);
        (uint256 creatorBefore, uint256 programmableBefore) = _feeSnapshot(result.poolId);

        uint256 netNativeOutput = 0.000_01 ether;
        BalanceDelta delta = _swap(key, false, int256(netNativeOutput), 0);
        (uint256 creatorAfter, uint256 programmableAfter) = _feeSnapshot(result.poolId);
        uint256 creatorIncrease = creatorAfter - creatorBefore;
        uint256 programmableIncrease = programmableAfter - programmableBefore;
        (uint256 expectedCreator, uint256 expectedProgrammable) =
            hook.quoteExactOutputFees(netNativeOutput, TOTAL_SWAP_FEE_BPS);

        assertEq(uint256(int256(delta.amount0())), netNativeOutput);
        assertEq(creatorIncrease, expectedCreator);
        assertEq(programmableIncrease, expectedProgrammable);
    }

    function _swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint256 value)
        private
        returns (BalanceDelta delta)
    {
        delta = swapRouter.swap{ value: value }(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _feeSnapshot(bytes32 poolId) private view returns (uint256 creatorAccrued, uint256 programmableAccrued) {
        creatorAccrued = _creatorFees(poolId);
        programmableAccrued = hook.launcherFeesAccrued();
    }

    function _assertGrossSplit(uint256 gross, uint256 creatorIncrease, uint256 programmableIncrease) private pure {
        assertEq(creatorIncrease, gross * CREATOR_FEE_BPS / BASIS_POINTS);
        assertEq(programmableIncrease, gross * PROGRAMMABLE_FEE_BPS / BASIS_POINTS);
        assertEq(creatorIncrease + programmableIncrease, gross * TOTAL_SWAP_FEE_BPS / BASIS_POINTS);
    }
}
