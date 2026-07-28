// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

import { ILiquidityGrowthOracleV1 } from "../../src/interfaces/ILiquidityGrowthOracleV1.sol";

contract MockLiquidityGrowthOracleV1 is ILiquidityGrowthOracleV1 {
    IPoolManager public immutable override poolManager;

    bytes32 public expectedPoolId;
    int56 public rawStart;
    int56 public rawEnd;
    int56 public truncatedStart;
    int56 public truncatedEnd;
    bool public malformed;
    bool public historyTooShort;

    error ObservationHistoryTooShort();
    error UnexpectedPool(bytes32 actual, bytes32 expected);

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    function configure(
        bytes32 expectedPoolId_,
        int56 rawStart_,
        int56 rawEnd_,
        int56 truncatedStart_,
        int56 truncatedEnd_
    ) external {
        expectedPoolId = expectedPoolId_;
        rawStart = rawStart_;
        rawEnd = rawEnd_;
        truncatedStart = truncatedStart_;
        truncatedEnd = truncatedEnd_;
    }

    function setMalformed(bool malformed_) external {
        malformed = malformed_;
    }

    function setHistoryTooShort(bool historyTooShort_) external {
        historyTooShort = historyTooShort_;
    }

    function observe(uint32[] calldata, PoolId poolId)
        external
        view
        override
        returns (int56[] memory tickCumulatives, int56[] memory truncatedTickCumulatives)
    {
        bytes32 actualPoolId = PoolId.unwrap(poolId);
        if (actualPoolId != expectedPoolId) revert UnexpectedPool(actualPoolId, expectedPoolId);
        if (historyTooShort) revert ObservationHistoryTooShort();

        tickCumulatives = new int56[](malformed ? 1 : 2);
        truncatedTickCumulatives = new int56[](2);
        tickCumulatives[0] = rawStart;
        if (!malformed) tickCumulatives[1] = rawEnd;
        truncatedTickCumulatives[0] = truncatedStart;
        truncatedTickCumulatives[1] = truncatedEnd;
    }
}
