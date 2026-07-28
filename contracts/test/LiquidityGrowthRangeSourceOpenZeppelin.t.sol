// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseOracleHookMock } from "@openzeppelin/uniswap-hooks/src/mocks/oracles/panoptic/BaseOracleHookMock.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { ILiquidityGrowthOracleV1 } from "../src/interfaces/ILiquidityGrowthOracleV1.sol";

contract LiquidityGrowthRangeSourceOpenZeppelinTest is Deployers {
    uint32 internal constant TWAP_WINDOW = 30 minutes;
    int24 internal constant MAX_ABS_TICK_DELTA = 1000;
    int24 internal constant RANGE_HALF_WIDTH = 30_000;
    int24 internal constant MAX_DEVIATION = 20_000;

    BaseOracleHookMock internal oracleHook;
    LiquidityGrowthRangeSourceV1 internal source;
    PoolKey internal observedKey;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        oracleHook = _deployOracleHook();
        (observedKey,) = initPool(currency0, currency1, IHooks(address(oracleHook)), 3000, int24(60), SQRT_PRICE_1_1);

        oracleHook.increaseObservationCardinalityNext(192, observedKey.toId());
        ModifyLiquidityParams memory parameters =
            ModifyLiquidityParams({ tickLower: -6000, tickUpper: 6000, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity(observedKey, parameters, ZERO_BYTES);

        source = new LiquidityGrowthRangeSourceV1(
            manager,
            observedKey,
            ILiquidityGrowthOracleV1(address(oracleHook)),
            TWAP_WINDOW,
            RANGE_HALF_WIDTH,
            MAX_DEVIATION
        );
    }

    function test_openZeppelinObservationHistorySatisfiesRangeSourceInterface() public {
        vm.warp(block.timestamp + 10 minutes);
        swap(observedKey, true, -int256(1 ether), ZERO_BYTES);
        vm.warp(block.timestamp + TWAP_WINDOW);

        LiquidityGrowthRangeSourceV1.RangeQuote memory quote = source.quoteRange();

        assertNotEq(quote.spotTick, 0);
        assertEq(quote.twapTick, quote.spotTick);
        assertLt(quote.tickLower, quote.spotTick);
        assertGt(quote.tickUpper, quote.spotTick);
        assertEq(quote.tickLower % observedKey.tickSpacing, 0);
        assertEq(quote.tickUpper % observedKey.tickSpacing, 0);
    }

    function _deployOracleHook() private returns (BaseOracleHookMock deployed) {
        uint160 flags = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG;
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this), flags, type(BaseOracleHookMock).creationCode, abi.encode(manager, MAX_ABS_TICK_DELTA)
        );
        deployed = new BaseOracleHookMock{ salt: salt }(manager, MAX_ABS_TICK_DELTA);
        assertEq(address(deployed), predicted);
    }
}
