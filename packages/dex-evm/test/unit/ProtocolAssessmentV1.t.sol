// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProtocolAssessmentV1 } from "../../src/core/ProtocolAssessmentV1.sol";
import { AssessmentHarness } from "../helpers/AssessmentHarness.sol";

contract ProtocolAssessmentV1Test is Test {
    AssessmentHarness internal harness;

    function setUp() external {
        harness = new AssessmentHarness();
    }

    function test_exactCumulativeFloorBoundaries() external view {
        assertEq(harness.assessmentAt(0), 0);
        assertEq(harness.assessmentAt(1999), 0);
        assertEq(harness.assessmentAt(2000), 1);
        assertEq(harness.assessmentAt(3999), 1);
        assertEq(harness.assessmentAt(4000), 2);
        assertEq(harness.assessmentAt(type(uint128).max), type(uint128).max / 2000);
    }

    function test_incrementalDeltaCrossesOnlyCumulativeBoundary() external view {
        ProtocolAssessmentV1.Delta memory result = harness.applyBasisDelta(1999, 1);
        assertEq(result.cumulativeBasisBefore, 1999);
        assertEq(result.cumulativeBasisAfter, 2000);
        assertEq(result.assessmentBefore, 0);
        assertEq(result.assessmentAfter, 1);
        assertEq(result.assessmentDelta, 1);
    }

    function test_splitAndMergeHaveIdenticalTotalAssessment() external view {
        ProtocolAssessmentV1.Delta memory first = harness.applyBasisDelta(0, 1111);
        ProtocolAssessmentV1.Delta memory second = harness.applyBasisDelta(first.cumulativeBasisAfter, 2222);
        ProtocolAssessmentV1.Delta memory merged = harness.applyBasisDelta(0, 3333);
        assertEq(first.assessmentDelta + second.assessmentDelta, merged.assessmentDelta);
        assertEq(second.cumulativeBasisAfter, merged.cumulativeBasisAfter);
    }

    function test_uint128OverflowFailsClosed() external {
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolAssessmentV1.CumulativeBasisOverflow.selector, type(uint128).max, uint128(1))
        );
        harness.applyBasisDelta(type(uint128).max, 1);
    }

    function test_basisRegressionFailsClosed() external {
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolAssessmentV1.CumulativeBasisRegression.selector, uint128(2), uint128(1))
        );
        harness.deltaBetween(2, 1);
    }
}
