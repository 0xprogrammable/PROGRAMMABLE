// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Project-specific curve implementations must define domain, rounding,
/// monotonicity and conservation properties. This interface supplies no curve.
interface ICustomPriceCurve {
    struct State {
        uint256 reserve0;
        uint256 reserve1;
        bytes32 parametersHash;
    }

    function quoteExactInput(State calldata state, bool zeroForOne, uint256 amountIn)
        external
        view
        returns (uint256 amountOut, State memory nextState);

    function quoteExactOutput(State calldata state, bool zeroForOne, uint256 amountOut)
        external
        view
        returns (uint256 amountIn, State memory nextState);

    function invariant(State calldata state) external view returns (uint256 invariantValue);
}
