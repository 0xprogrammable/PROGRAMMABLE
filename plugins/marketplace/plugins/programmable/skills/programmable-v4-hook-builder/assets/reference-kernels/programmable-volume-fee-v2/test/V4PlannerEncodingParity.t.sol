// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";

import { V4PlannerParityEncoder } from "./helpers/UniversalRouterV4Fixture.sol";

contract V4PlannerEncodingParityTest is Test {
    Currency private constant CURRENCY_A = Currency.wrap(0x0000000000000000000000000000000000000011);
    Currency private constant CURRENCY_B = Currency.wrap(0x0000000000000000000000000000000000000022);
    Currency private constant CURRENCY_C = Currency.wrap(0x0000000000000000000000000000000000000033);
    IHooks private constant HOOK = IHooks(0x00000000000000000000000000000000000000AA);

    function testSolidityRouteEncodingMatchesPinnedV4PlannerAndRoutePlanner() public view {
        string memory json =
            vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/v4-routing-parity-vectors.json"));
        PoolKey memory poolKey =
            PoolKey({ currency0: CURRENCY_A, currency1: CURRENCY_B, fee: 3000, tickSpacing: 60, hooks: HOOK });

        (bytes memory commands, bytes[] memory inputs) =
            V4PlannerParityEncoder.exactInputSingle(poolKey, true, 1 ether, 123, hex"010203", CURRENCY_A, CURRENCY_B);
        _assertVector(json, 0, commands, inputs);

        (commands, inputs) = V4PlannerParityEncoder.exactOutputSingle(
            poolKey, false, 456, 789, abi.encode(uint256(1_000_000)), CURRENCY_B, CURRENCY_A
        );
        _assertVector(json, 1, commands, inputs);

        PathKey[] memory exactInputPath = new PathKey[](2);
        exactInputPath[0] =
            PathKey({ intermediateCurrency: CURRENCY_B, fee: 3000, tickSpacing: 60, hooks: HOOK, hookData: hex"3344" });
        exactInputPath[1] = PathKey({
            intermediateCurrency: CURRENCY_C,
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(0)),
            hookData: hex"556677"
        });
        (commands, inputs) = V4PlannerParityEncoder.exactInput(CURRENCY_A, exactInputPath, 1 ether, 321, CURRENCY_C);
        _assertVector(json, 2, commands, inputs);

        PathKey[] memory exactOutputPath = new PathKey[](2);
        exactOutputPath[0] = PathKey({
            intermediateCurrency: CURRENCY_A, fee: 500, tickSpacing: 10, hooks: IHooks(address(0)), hookData: hex"1122"
        });
        exactOutputPath[1] = PathKey({
            intermediateCurrency: CURRENCY_B,
            fee: 3000,
            tickSpacing: 60,
            hooks: HOOK,
            hookData: abi.encode(uint256(1_000_000))
        });
        (commands, inputs) = V4PlannerParityEncoder.exactOutput(CURRENCY_A, CURRENCY_C, exactOutputPath, 654, 987);
        _assertVector(json, 3, commands, inputs);

        PoolKey memory nativeInputPoolKey = PoolKey({
            currency0: Currency.wrap(address(0)), currency1: CURRENCY_B, fee: 3000, tickSpacing: 60, hooks: HOOK
        });
        (commands, inputs) = V4PlannerParityEncoder.exactOutputSingleNativeInput(
            nativeInputPoolKey, true, 456, 789, abi.encode(uint256(1_000_000)), CURRENCY_B
        );
        _assertVector(json, 4, commands, inputs);
    }

    function _assertVector(string memory json, uint256 index, bytes memory commands, bytes[] memory inputs)
        private
        pure
    {
        string memory root = string.concat(".vectors[", vm.toString(index), "]");
        assertEq(commands, vm.parseJsonBytes(json, string.concat(root, ".routePlannerCommands")));
        assertEq(keccak256(inputs[0]), vm.parseJsonBytes32(json, string.concat(root, ".v4PlannerFinalizedKeccak256")));
        uint256 expectedInputCount = vm.parseJsonUint(json, string.concat(root, ".routePlannerInputCount"));
        assertEq(inputs.length, expectedInputCount, "RoutePlanner input count drifted");
        for (uint256 inputIndex; inputIndex < expectedInputCount; ++inputIndex) {
            bytes32 expectedInputHash = vm.parseJsonBytes32(
                json, string.concat(root, ".routePlannerInputKeccak256es[", vm.toString(inputIndex), "]")
            );
            assertEq(keccak256(inputs[inputIndex]), expectedInputHash, "RoutePlanner input hash drifted");
        }
    }
}
