// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ExecutionLockV1 } from "../../src/core/ExecutionLockV1.sol";
import {
    ExecutionLockHarness,
    NestedMutationAndReadActor,
    PhaseCorruptionHarness
} from "../mocks/ExecutionLockActors.sol";

contract ExecutionLockAdversarialTest is Test {
    /// Threat: actor=router callback; authority=nested calldata; pre=ENGINE/0; attempt=mutate+read; expect=both fail;
    /// post=commit 1.
    function test_hostileRouterCannotMutateOrReadPartialCheckpointDuringActivePhase() external {
        ExecutionLockHarness harness = new ExecutionLockHarness();
        NestedMutationAndReadActor hostileRouter = new NestedMutationAndReadActor(harness);

        harness.callHostileActor(hostileRouter);

        assertFalse(hostileRouter.nestedMutationSucceeded(), "nested mutation unexpectedly succeeded");
        assertFalse(hostileRouter.partialReadSucceeded(), "partial evidence read unexpectedly succeeded");
        assertEq(harness.checkpoint(), 1, "outer committed checkpoint missing");
        assertEq(uint8(harness.executionPhase()), uint8(ExecutionLockV1.Phase.IDLE));
    }

    /// Threat: actor=phase-confused component; authority=requested phase; pre=AUTHENTICATE; attempt=jump;
    /// expect=revert; post=IDLE.
    function test_invalidPhaseTransitionRevertsAndLeavesNoPartialState() external {
        PhaseCorruptionHarness harness = new PhaseCorruptionHarness();
        vm.expectRevert();
        harness.invalidTransition();
        assertEq(uint8(harness.executionPhase()), uint8(ExecutionLockV1.Phase.IDLE));
    }

    /// Threat: actor=prior submitter; authority=ordering only; pre=IDLE; attempt=two sequential calls; expect=commit;
    /// post=2/IDLE.
    function test_sequentialIndependentMutationsRemainAvailableAfterCommit() external {
        ExecutionLockHarness harness = new ExecutionLockHarness();
        harness.mutate();
        harness.mutate();
        assertEq(harness.checkpoint(), 2);
    }
}
