// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IStateView } from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import { Test } from "forge-std/Test.sol";

import { ILiquidityGrowthFeeOracleHookV2 } from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

interface IDeepV3CanaryUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

struct DeepV3CanaryExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    bytes hookData;
}

contract DeepV3CanaryBatchMainnetForkTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_637_905;
    uint256 internal constant LIVE_WALLET_BALANCE = 0.006_194_400_813_638_393 ether;
    uint256 internal constant LIVE_MAX_FEE_PER_GAS = 162_472_184;
    uint256 internal constant GAS_BUFFER_NUMERATOR = 120;
    uint256 internal constant GAS_BUFFER_DENOMINATOR = 100;

    uint8 internal constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant SETTLE_ALL = 0x0c;
    uint8 internal constant UR_SWEEP = 0x04;
    uint8 internal constant UR_V4_SWAP = 0x10;

    address internal constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address internal constant UNIVERSAL_ROUTER = 0xd92A36B0000531EF3063dEd4De20A0783308446C;
    address internal constant FEE_HOOK = 0x864aF5CEaD61068b944e9974638760F1bD2dFaeC;
    address internal constant TOKEN = 0x628BDD54595930cF0AfC8e432E3102eFef0D957B;
    bytes32 internal constant POOL_ID = 0x45e5d3e0e106819e2eb8a97f63661ff71c795fb364ec5fae42127c3ed71e5c18;

    uint256 internal constant MAX_NATIVE_DEBT = 0.0034 ether;
    uint256 internal constant MINIMUM_REFUND = 0.001 ether;
    uint256 internal constant EXPECTED_GROWTH_FEES = 0.002_041_74 ether;
    uint256 internal constant EXPECTED_TOTAL_LOSS = 0.002_268_6 ether;

    uint256 internal constant NINETEEN_CYCLES = 19;
    uint256 internal constant NINETEEN_FULL_TRANSACTION_GAS = 2_034_391;
    uint128 internal constant NINETEEN_BUY_AMOUNT = 0.006 ether;
    uint128 internal constant NINETEEN_BUY_MINIMUM = 4_315_122_607_712_108_858_671_086;
    uint128 internal constant NINETEEN_SELL_MINIMUM = 0.005_821_794 ether;

    uint256 internal constant TWENTY_CYCLES = 20;
    uint256 internal constant TWENTY_FULL_TRANSACTION_GAS = 2_136_864;
    uint128 internal constant TWENTY_BUY_AMOUNT = 0.0057 ether;
    uint128 internal constant TWENTY_BUY_MINIMUM = 4_100_260_461_119_374_088_036_303;
    uint128 internal constant TWENTY_SELL_MINIMUM = 0.005_530_704_3 ether;

    ILiquidityGrowthFeeOracleHookV2 internal constant hook = ILiquidityGrowthFeeOracleHookV2(FEE_HOOK);
    IStateView internal constant stateView = IStateView(STATE_VIEW);
    IDeepV3CanaryUniversalRouter internal constant router = IDeepV3CanaryUniversalRouter(UNIVERSAL_ROUTER);

    PoolKey internal key;
    address internal trader;

    struct BatchResult {
        uint256 callGas;
        uint256 calldataLength;
        uint256 actualLoss;
        uint256 actualRefund;
        uint256 growthFees;
        uint256 programmableFees;
        uint160 sqrtPriceBefore;
        uint160 sqrtPriceAfter;
        int24 tickBefore;
        int24 tickAfter;
    }

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);

        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(TOKEN),
            fee: 0,
            tickSpacing: 200,
            hooks: IHooks(FEE_HOOK)
        });
        trader = makeAddr("deep-v3-canary-batch-trader");
        vm.deal(trader, LIVE_WALLET_BALANCE);

        (address growthVault,, uint8 lifecycle,) = hook.poolFeeConfig(POOL_ID);
        assertTrue(growthVault != address(0));
        assertEq(lifecycle, hook.LIFECYCLE_FINALIZED());
        assertEq(PoolId.unwrap(_poolId(key)), POOL_ID);
        assertEq(UNIVERSAL_ROUTER.codehash, 0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49);
    }

    function test_nineteenRoundTripsReachCanaryThreshold() public {
        BatchResult memory result =
            _executeBatch(NINETEEN_CYCLES, NINETEEN_BUY_AMOUNT, NINETEEN_BUY_MINIMUM, NINETEEN_SELL_MINIMUM);

        _assertBatchResult(result, NINETEEN_CYCLES, NINETEEN_FULL_TRANSACTION_GAS);
        emit log_named_uint("Deep V3 19-cycle router-call gas", result.callGas);
        emit log_named_uint("Deep V3 19-cycle calldata bytes", result.calldataLength);
        emit log_named_uint("Deep V3 19-cycle actual refund", result.actualRefund);
        emit log_named_uint(
            "Deep V3 19-cycle maximum upfront envelope", _maximumUpfrontEnvelope(NINETEEN_FULL_TRANSACTION_GAS)
        );
    }

    function test_twentyRoundTripsFitCurrentWalletEnvelope() public {
        BatchResult memory result =
            _executeBatch(TWENTY_CYCLES, TWENTY_BUY_AMOUNT, TWENTY_BUY_MINIMUM, TWENTY_SELL_MINIMUM);

        _assertBatchResult(result, TWENTY_CYCLES, TWENTY_FULL_TRANSACTION_GAS);
        emit log_named_uint("Deep V3 20-cycle router-call gas", result.callGas);
        emit log_named_uint("Deep V3 20-cycle calldata bytes", result.calldataLength);
        emit log_named_uint("Deep V3 20-cycle actual refund", result.actualRefund);
        emit log_named_uint(
            "Deep V3 20-cycle maximum upfront envelope", _maximumUpfrontEnvelope(TWENTY_FULL_TRANSACTION_GAS)
        );
    }

    function _executeBatch(uint256 cycles, uint128 buyAmount, uint128 buyMinimum, uint128 sellMinimum)
        private
        returns (BatchResult memory result)
    {
        (result.sqrtPriceBefore, result.tickBefore,,) = stateView.getSlot0(PoolId.wrap(POOL_ID));
        (,,, uint256 growthFeesBefore) = hook.poolFeeConfig(POOL_ID);
        uint256 programmableFeesBefore = hook.launcherFeesAccrued();
        uint256 traderBalanceBefore = trader.balance;
        uint256 routerBalanceBefore = UNIVERSAL_ROUTER.balance;

        (bytes memory commands, bytes[] memory inputs, uint256 calldataLength) =
            _batchCalldata(cycles, buyAmount, buyMinimum, sellMinimum);
        result.calldataLength = calldataLength;

        uint256 gasBefore = gasleft();
        vm.prank(trader);
        router.execute{ value: MAX_NATIVE_DEBT }(commands, inputs, block.timestamp + 5 minutes);
        result.callGas = gasBefore - gasleft();

        (result.sqrtPriceAfter, result.tickAfter,,) = stateView.getSlot0(PoolId.wrap(POOL_ID));
        (,,, uint256 growthFeesAfter) = hook.poolFeeConfig(POOL_ID);
        uint256 programmableFeesAfter = hook.launcherFeesAccrued();

        result.actualLoss = traderBalanceBefore - trader.balance;
        result.actualRefund = MAX_NATIVE_DEBT - result.actualLoss;
        result.growthFees = growthFeesAfter - growthFeesBefore;
        result.programmableFees = programmableFeesAfter - programmableFeesBefore;

        assertEq(UNIVERSAL_ROUTER.balance, routerBalanceBefore);
        assertEq(IERC20(TOKEN).balanceOf(trader), 0);
    }

    function _batchCalldata(uint256 cycles, uint128 buyAmount, uint128 buyMinimum, uint128 sellMinimum)
        private
        view
        returns (bytes memory commands, bytes[] memory inputs, uint256 calldataLength)
    {
        bytes memory actions = new bytes(cycles * 2 + 1);
        bytes[] memory actionParameters = new bytes[](cycles * 2 + 1);

        for (uint256 i; i < cycles; ++i) {
            uint256 buyIndex = i * 2;
            actions[buyIndex] = bytes1(SWAP_EXACT_IN_SINGLE);
            actionParameters[buyIndex] = abi.encode(
                DeepV3CanaryExactInputSingleParams({
                    poolKey: key, zeroForOne: true, amountIn: buyAmount, amountOutMinimum: buyMinimum, hookData: ""
                })
            );

            uint256 sellIndex = buyIndex + 1;
            actions[sellIndex] = bytes1(SWAP_EXACT_IN_SINGLE);
            actionParameters[sellIndex] = abi.encode(
                DeepV3CanaryExactInputSingleParams({
                    poolKey: key, zeroForOne: false, amountIn: 0, amountOutMinimum: sellMinimum, hookData: ""
                })
            );
        }

        actions[cycles * 2] = bytes1(SETTLE_ALL);
        actionParameters[cycles * 2] = abi.encode(address(0), MAX_NATIVE_DEBT);

        commands = abi.encodePacked(UR_V4_SWAP, UR_SWEEP);
        inputs = new bytes[](2);
        inputs[0] = abi.encode(actions, actionParameters);
        inputs[1] = abi.encode(address(0), trader, MINIMUM_REFUND);
        calldataLength =
        abi.encodeCall(IDeepV3CanaryUniversalRouter.execute, (commands, inputs, block.timestamp + 5 minutes)).length;
    }

    function _assertBatchResult(BatchResult memory result, uint256 cycles, uint256 fullTransactionGas) private pure {
        assertEq(result.growthFees, EXPECTED_GROWTH_FEES);
        assertEq(result.actualLoss, EXPECTED_TOTAL_LOSS);
        assertEq(result.actualRefund, MAX_NATIVE_DEBT - EXPECTED_TOTAL_LOSS);
        assertEq(result.tickAfter, result.tickBefore);
        assertLe(_absoluteDifference(result.sqrtPriceAfter, result.sqrtPriceBefore), cycles * 2_000_000);
        assertLt(result.callGas, 2_500_000);
        assertLe(_maximumUpfrontEnvelope(fullTransactionGas), LIVE_WALLET_BALANCE);
        assertGe(result.actualRefund, MINIMUM_REFUND);
        assertEq(result.actualLoss - result.growthFees - result.programmableFees, cycles);
    }

    function _maximumUpfrontEnvelope(uint256 measuredFullTransactionGas) private pure returns (uint256) {
        uint256 bufferedGas =
            (measuredFullTransactionGas * GAS_BUFFER_NUMERATOR + GAS_BUFFER_DENOMINATOR - 1) / GAS_BUFFER_DENOMINATOR;
        return MAX_NATIVE_DEBT + bufferedGas * LIVE_MAX_FEE_PER_GAS;
    }

    function _poolId(PoolKey memory poolKey) private pure returns (PoolId) {
        return PoolId.wrap(keccak256(abi.encode(poolKey)));
    }

    function _absoluteDifference(uint160 left, uint160 right) private pure returns (uint256) {
        return left > right ? uint256(left - right) : uint256(right - left);
    }
}
