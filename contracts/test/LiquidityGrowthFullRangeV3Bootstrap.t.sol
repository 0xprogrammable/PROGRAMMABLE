// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../src/LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthFullRangeV3Fixture } from "./utils/LiquidityGrowthFullRangeV3Fixture.sol";

contract LiquidityGrowthFullRangeV3BootstrapTest is LiquidityGrowthFullRangeV3Fixture {
    uint256 private constant ROUND_TRIPS = 19;
    uint256 private constant BUY_PER_ROUND_TRIP = 0.006 ether;

    function _initialBuy() internal pure override returns (uint256) {
        return Policy.MIN_INITIAL_BUY_WEI;
    }

    function test_minimumLaunchBecomesActionableAtTheFirstFeeThreshold() public {
        _matureV3Oracle();
        for (uint256 cycle; cycle < ROUND_TRIPS; ++cycle) {
            BalanceDelta buy = _ordinaryV3Buy(BUY_PER_ROUND_TRIP);
            uint256 tokenOut = uint256(int256(buy.amount1()));
            swapRouter.swap(
                v3Key,
                SwapParams({
                    zeroForOne: false,
                    amountSpecified: -int256(tokenOut),
                    sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
                }),
                v3SwapSettings,
                ""
            );
        }

        (
            LiquidityGrowthFullRangeVaultV3.WorkAction action,
            uint256 growthFees,,,
            uint256 rollingCapacity,
            bytes4 blockedReason
        ) = v3Vault.workState();

        assertGe(growthFees, Policy.MIN_COMPOUND_NATIVE);
        assertGe(rollingCapacity, Policy.MIN_COMPOUND_NATIVE);
        assertEq(blockedReason, bytes4(0));
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeVaultV3.WorkAction.Compound));

        LiquidityGrowthFullRangeVaultV3.CompoundResult memory result = v3Vault.compound();
        assertEq(result.growthFeesClaimed, growthFees);
        assertGt(result.liquidityAdded, 0);
        assertEq(v3Vault.compoundNonce(), 1);
    }
}
