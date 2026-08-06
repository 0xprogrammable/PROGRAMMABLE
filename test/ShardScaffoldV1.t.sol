// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { Base64 } from "solady/utils/Base64.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

contract ShardScaffoldV1Test is Test {
    // Reference the BaseHook type so a broken import path is a hard compile
    // error rather than an unused-import warning.
    function _baseHookTypeName() internal pure returns (string memory) {
        return type(BaseHook).name;
    }

    function test_baseHookImportResolves() public pure {
        assertEq(_baseHookTypeName(), "BaseHook");
    }

    function test_swapParamsImportResolves() public pure {
        SwapParams memory params = SwapParams({ zeroForOne: true, amountSpecified: 1, sqrtPriceLimitX96: 0 });
        assertEq(params.amountSpecified, 1);
    }

    function test_tickMathConstants() public pure {
        assertEq(TickMath.MIN_TICK, -887_272);
        assertEq(TickMath.MAX_TICK, 887_272);
    }

    function test_currencyWrapUnwrap() public pure {
        assertEq(Currency.unwrap(Currency.wrap(address(0))), address(0));
    }

    function test_base64Encode() public pure {
        assertEq(Base64.encode(bytes("ab")), "YWI=");
    }

    function test_create2PredictionImportResolves() public pure {
        address predicted = Create2.computeAddress(bytes32(uint256(1)), keccak256("initcode"), address(0xBEEF));
        assertTrue(predicted != address(0));
    }
}
