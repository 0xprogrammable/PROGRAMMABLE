// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAllowanceTransfer } from "@uniswap/permit2/src/interfaces/IAllowanceTransfer.sol";
import { Commands } from "@uniswap/universal-router/contracts/libraries/Commands.sol";
import { Constants } from "@uniswap/universal-router/contracts/libraries/Constants.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { ActionConstants } from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { IV4Router } from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { V4Quoter } from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { MockReferenceToken } from "../MockReferenceToken.sol";
import { MockWETH9 } from "../MockWETH9.sol";

interface IUniversalRouterV4 {
    error ExecutionFailed(uint256 commandIndex, bytes message);
    error TransactionDeadlinePassed();

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

struct UniversalRouterArtifactParameters {
    address permit2;
    address weth9;
    address v2Factory;
    address v3Factory;
    bytes32 pairInitCodeHash;
    bytes32 poolInitCodeHash;
    address v4PoolManager;
    address v3NFTPositionManager;
    address v4PositionManager;
    address spokePool;
}

struct ExactInputMultihopV2_1_1 {
    Currency currencyIn;
    PathKey[] path;
    uint256[] minHopPriceX36;
    uint128 amountIn;
    uint128 amountOutMinimum;
}

struct ExactOutputMultihopV2_1_1 {
    Currency currencyOut;
    PathKey[] path;
    uint256[] minHopPriceX36;
    uint128 amountOut;
    uint128 amountInMaximum;
}

library V4PlannerParityEncoder {
    function exactInputSingle(
        PoolKey memory poolKey,
        bool zeroForOne,
        uint128 amountIn,
        uint128 amountOutMinimum,
        bytes memory hookData,
        Currency currencyIn,
        Currency currencyOut
    ) internal pure returns (bytes memory commands, bytes[] memory inputs) {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: poolKey,
                zeroForOne: zeroForOne,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                hookData: hookData
            })
        );
        params[1] = _settle(currencyIn);
        params[2] = _take(currencyOut, 0);
        return _route(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE)), params
        );
    }

    function exactOutputSingle(
        PoolKey memory poolKey,
        bool zeroForOne,
        uint128 amountOut,
        uint128 amountInMaximum,
        bytes memory hookData,
        Currency currencyIn,
        Currency currencyOut
    ) internal pure returns (bytes memory commands, bytes[] memory inputs) {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactOutputSingleParams({
                poolKey: poolKey,
                zeroForOne: zeroForOne,
                amountOut: amountOut,
                amountInMaximum: amountInMaximum,
                hookData: hookData
            })
        );
        params[1] = _settle(currencyIn);
        params[2] = _take(currencyOut, amountOut);
        return _route(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_OUT_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE)), params
        );
    }

    function exactOutputSingleNativeInput(
        PoolKey memory poolKey,
        bool zeroForOne,
        uint128 amountOut,
        uint128 amountInMaximum,
        bytes memory hookData,
        Currency currencyOut
    ) internal pure returns (bytes memory commands, bytes[] memory inputs) {
        (commands, inputs) = exactOutputSingle(
            poolKey, zeroForOne, amountOut, amountInMaximum, hookData, Currency.wrap(address(0)), currencyOut
        );

        bytes[] memory inputsWithRefund = new bytes[](2);
        inputsWithRefund[0] = inputs[0];
        inputsWithRefund[1] = abi.encode(Constants.ETH, ActionConstants.MSG_SENDER, uint256(0));
        commands = abi.encodePacked(commands, uint8(Commands.SWEEP));
        inputs = inputsWithRefund;
    }

    function exactInput(
        Currency currencyIn,
        PathKey[] memory path,
        uint128 amountIn,
        uint128 amountOutMinimum,
        Currency currencyOut
    ) internal pure returns (bytes memory commands, bytes[] memory inputs) {
        bytes[] memory params = new bytes[](3);
        uint256[] memory minHopPriceX36 = new uint256[](0);
        params[0] = abi.encode(
            ExactInputMultihopV2_1_1({
                currencyIn: currencyIn,
                path: path,
                minHopPriceX36: minHopPriceX36,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum
            })
        );
        params[1] = _settle(currencyIn);
        params[2] = _take(currencyOut, 0);
        return
            _route(abi.encodePacked(uint8(Actions.SWAP_EXACT_IN), uint8(Actions.SETTLE), uint8(Actions.TAKE)), params);
    }

    function exactOutput(
        Currency currencyIn,
        Currency currencyOut,
        PathKey[] memory path,
        uint128 amountOut,
        uint128 amountInMaximum
    ) internal pure returns (bytes memory commands, bytes[] memory inputs) {
        bytes[] memory params = new bytes[](3);
        uint256[] memory minHopPriceX36 = new uint256[](0);
        params[0] = abi.encode(
            ExactOutputMultihopV2_1_1({
                currencyOut: currencyOut,
                path: path,
                minHopPriceX36: minHopPriceX36,
                amountOut: amountOut,
                amountInMaximum: amountInMaximum
            })
        );
        params[1] = _settle(currencyIn);
        params[2] = _take(currencyOut, amountOut);
        return
            _route(abi.encodePacked(uint8(Actions.SWAP_EXACT_OUT), uint8(Actions.SETTLE), uint8(Actions.TAKE)), params);
    }

    function _settle(Currency currency) private pure returns (bytes memory) {
        return abi.encode(currency, uint256(ActionConstants.OPEN_DELTA), true);
    }

    function _take(Currency currency, uint256 amount) private pure returns (bytes memory) {
        return abi.encode(currency, ActionConstants.MSG_SENDER, amount);
    }

    function _route(bytes memory actions, bytes[] memory params)
        private
        pure
        returns (bytes memory commands, bytes[] memory inputs)
    {
        commands = abi.encodePacked(uint8(Commands.V4_SWAP));
        inputs = new bytes[](1);
        // RoutePlanner's V4_SWAP parser forwards V4Planner.finalize() without another ABI wrapper.
        inputs[0] = abi.encode(actions, params);
    }
}

abstract contract UniversalRouterV4Fixture {
    IUniversalRouterV4 internal universalRouter;
    IV4Quoter internal v4Quoter;
    address internal permit2;
    MockWETH9 internal weth9;

    function _universalRouterConstructorArgs(IPoolManager poolManager, address permit2_)
        internal
        returns (bytes memory)
    {
        permit2 = permit2_;
        weth9 = new MockWETH9();
        return abi.encode(
            UniversalRouterArtifactParameters({
                permit2: permit2_,
                weth9: address(weth9),
                v2Factory: address(0),
                v3Factory: address(0),
                pairInitCodeHash: bytes32(0),
                poolInitCodeHash: bytes32(0),
                v4PoolManager: address(poolManager),
                v3NFTPositionManager: address(0),
                v4PositionManager: address(0),
                spokePool: address(0)
            })
        );
    }

    function _bindUniversalRouter(address universalRouter_) internal {
        universalRouter = IUniversalRouterV4(universalRouter_);
    }

    function _bindV4Quoter(IPoolManager poolManager) internal {
        v4Quoter = new V4Quoter(poolManager);
    }

    function _quoteExactInputSingle(PoolKey memory poolKey, bool zeroForOne, uint128 amountIn, bytes memory hookData)
        internal
        returns (uint256 amountOut)
    {
        (amountOut,) = v4Quoter.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: poolKey, zeroForOne: zeroForOne, exactAmount: amountIn, hookData: hookData
            })
        );
    }

    function _quoteExactOutputSingle(PoolKey memory poolKey, bool zeroForOne, uint128 amountOut, bytes memory hookData)
        internal
        returns (uint256 amountIn)
    {
        (amountIn,) = v4Quoter.quoteExactOutputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: poolKey, zeroForOne: zeroForOne, exactAmount: amountOut, hookData: hookData
            })
        );
    }

    function _approvePermit2(MockReferenceToken token) internal {
        token.approve(permit2, type(uint256).max);
        IAllowanceTransfer(permit2)
            .approve(address(token), address(universalRouter), type(uint160).max, type(uint48).max);
    }
}
