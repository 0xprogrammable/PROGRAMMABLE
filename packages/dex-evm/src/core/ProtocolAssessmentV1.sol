// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Unambiguous uint128 cumulative-floor arithmetic for ProtocolAssessmentV1.
/// @dev Refund validity, grouping, funding, and storage are deliberately outside this library.
library ProtocolAssessmentV1 {
    uint128 internal constant DENOMINATOR = 2000;

    error CumulativeBasisOverflow(uint128 cumulativeBasisBefore, uint128 basisDelta);
    error CumulativeBasisRegression(uint128 cumulativeBasisBefore, uint128 cumulativeBasisAfter);

    struct Delta {
        uint128 cumulativeBasisBefore;
        uint128 cumulativeBasisAfter;
        uint128 assessmentBefore;
        uint128 assessmentAfter;
        uint128 assessmentDelta;
    }

    function assessmentAt(uint128 cumulativeBasis) internal pure returns (uint128) {
        return cumulativeBasis / DENOMINATOR;
    }

    function applyBasisDelta(uint128 cumulativeBasisBefore, uint128 basisDelta)
        internal
        pure
        returns (Delta memory result)
    {
        uint128 cumulativeBasisAfter;
        unchecked {
            cumulativeBasisAfter = cumulativeBasisBefore + basisDelta;
        }
        if (cumulativeBasisAfter < cumulativeBasisBefore) {
            revert CumulativeBasisOverflow(cumulativeBasisBefore, basisDelta);
        }

        uint128 assessmentBefore = assessmentAt(cumulativeBasisBefore);
        uint128 assessmentAfter = assessmentAt(cumulativeBasisAfter);
        result = Delta({
            cumulativeBasisBefore: cumulativeBasisBefore,
            cumulativeBasisAfter: cumulativeBasisAfter,
            assessmentBefore: assessmentBefore,
            assessmentAfter: assessmentAfter,
            assessmentDelta: assessmentAfter - assessmentBefore
        });
    }

    function deltaBetween(uint128 cumulativeBasisBefore, uint128 cumulativeBasisAfter) internal pure returns (uint128) {
        if (cumulativeBasisAfter < cumulativeBasisBefore) {
            revert CumulativeBasisRegression(cumulativeBasisBefore, cumulativeBasisAfter);
        }
        return assessmentAt(cumulativeBasisAfter) - assessmentAt(cumulativeBasisBefore);
    }
}
