// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ExecutionLockV1 } from "../../src/core/ExecutionLockV1.sol";

interface IExecutionLockHostileActor {
    function attack() external;
}

contract ExecutionLockHarness is ExecutionLockV1 {
    uint256 private _checkpoint;

    function mutate() external mutationEntry {
        _checkpoint += 1;
    }

    function callHostileActor(IExecutionLockHostileActor actor) external mutationEntry {
        _transitionPhase(Phase.AUTHENTICATE, Phase.ENGINE);
        actor.attack();
        _transitionPhase(Phase.ENGINE, Phase.POSTCHECK);
        _checkpoint += 1;
        _transitionPhase(Phase.POSTCHECK, Phase.COMMIT);
    }

    function checkpoint() external view committedEvidenceRead returns (uint256) {
        return _checkpoint;
    }
}

contract NestedMutationAndReadActor is IExecutionLockHostileActor {
    ExecutionLockHarness public immutable HARNESS;
    bool public nestedMutationSucceeded;
    bool public partialReadSucceeded;

    constructor(ExecutionLockHarness harness) {
        HARNESS = harness;
    }

    function attack() external {
        (nestedMutationSucceeded,) = address(HARNESS).call(abi.encodeCall(ExecutionLockHarness.mutate, ()));
        (partialReadSucceeded,) = address(HARNESS).staticcall(abi.encodeCall(ExecutionLockHarness.checkpoint, ()));
    }
}

contract PhaseCorruptionHarness is ExecutionLockV1 {
    function invalidTransition() external mutationEntry {
        _transitionPhase(Phase.ENGINE, Phase.COMMIT);
    }
}
