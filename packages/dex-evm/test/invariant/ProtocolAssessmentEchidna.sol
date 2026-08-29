// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAssessmentV1 } from "../../src/core/ProtocolAssessmentV1.sol";

/// @notice Dependency-free stateful harness for Echidna 2.3.3.
contract ProtocolAssessmentEchidna {
    uint128 public cumulativeBasis;
    uint128 public cumulativeAssessment;

    function addBasis(uint128 basisDelta) external {
        if (basisDelta > type(uint128).max - cumulativeBasis) return;
        ProtocolAssessmentV1.Delta memory result = ProtocolAssessmentV1.applyBasisDelta(cumulativeBasis, basisDelta);
        cumulativeBasis = result.cumulativeBasisAfter;
        cumulativeAssessment += result.assessmentDelta;
    }

    function echidna_cumulative_floor_is_exact() external view returns (bool) {
        return cumulativeAssessment == cumulativeBasis / 2000;
    }

    function echidna_assessment_never_exceeds_basis() external view returns (bool) {
        return cumulativeAssessment <= cumulativeBasis;
    }

    function echidna_denominator_is_fixed() external pure returns (bool) {
        return ProtocolAssessmentV1.assessmentAt(4000) == 2;
    }
}
