// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAssessmentV1 } from "../../src/core/ProtocolAssessmentV1.sol";

contract AssessmentHarness {
    function assessmentAt(uint128 basis) external pure returns (uint128) {
        return ProtocolAssessmentV1.assessmentAt(basis);
    }

    function applyBasisDelta(uint128 beforeBasis, uint128 delta)
        external
        pure
        returns (ProtocolAssessmentV1.Delta memory)
    {
        return ProtocolAssessmentV1.applyBasisDelta(beforeBasis, delta);
    }

    function deltaBetween(uint128 beforeBasis, uint128 afterBasis) external pure returns (uint128) {
        return ProtocolAssessmentV1.deltaBetween(beforeBasis, afterBasis);
    }
}
