// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Cumulative 0.1% volume accounting for a separately reviewed
/// zero-AMM settlement adapter. This library does not move or settle currency.
library ZeroAmmFeeAccumulator {
    address internal constant PROGRAMMABLE_FEE_OWNER = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint256 internal constant VOLUME_PER_FEE_UNIT = 1_000;

    struct State {
        uint256 cumulativeGrossVolume;
        uint256 cumulativePlatformFee;
    }

    function accrue(State storage state, uint256 grossVolume)
        internal
        returns (uint256 newlyAccrued)
    {
        uint256 nextVolume = state.cumulativeGrossVolume + grossVolume;
        uint256 nextPlatformFee = nextVolume / VOLUME_PER_FEE_UNIT;
        newlyAccrued = nextPlatformFee - state.cumulativePlatformFee;
        state.cumulativeGrossVolume = nextVolume;
        state.cumulativePlatformFee = nextPlatformFee;
    }
}
