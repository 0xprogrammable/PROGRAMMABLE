// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { CoreStandardFeeSource, CoreTestBase } from "./CoreTestBase.t.sol";

contract CoreRevenueInvariantHandler is Test {
    CoreStandardFeeSource public immutable sourceA;
    CoreStandardFeeSource public immutable sourceB;
    bytes32 public immutable sourceIdA;
    bytes32 public immutable sourceIdB;

    address internal immutable EXECUTOR;

    uint256 public totalAccruedA;
    uint256 public totalAccruedB;

    constructor(
        CoreStandardFeeSource sourceA_,
        CoreStandardFeeSource sourceB_,
        address executor_,
        bytes32 sourceIdA_,
        bytes32 sourceIdB_
    ) {
        sourceA = sourceA_;
        sourceB = sourceB_;
        EXECUTOR = executor_;
        sourceIdA = sourceIdA_;
        sourceIdB = sourceIdB_;
    }

    function accrueA(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 10 ether);
        vm.deal(address(this), address(this).balance + amount);
        sourceA.accrueNative{ value: amount }();
        totalAccruedA += amount;
    }

    function accrueB(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 10 ether);
        vm.deal(address(this), address(this).balance + amount);
        sourceB.accrueNative{ value: amount }();
        totalAccruedB += amount;
    }

    function claimA() external {
        _callExecutor(abi.encodeWithSignature("claimSource(bytes32)", sourceIdA));
    }

    function claimB() external {
        _callExecutor(abi.encodeWithSignature("claimSource(bytes32)", sourceIdB));
    }

    function claimBatch(bool reverseOrder) external {
        bytes32[] memory sourceIds = new bytes32[](2);
        sourceIds[reverseOrder ? 1 : 0] = sourceIdA;
        sourceIds[reverseOrder ? 0 : 1] = sourceIdB;
        _callExecutor(abi.encodeWithSignature("claimBatch(bytes32[])", sourceIds));
    }

    function claimADirectly() external {
        sourceA.claimProgrammableFees(address(0));
    }

    function claimBDirectly() external {
        sourceB.claimProgrammableFees(address(0));
    }

    function observeA() external {
        _callExecutor(abi.encodeWithSignature("observeSource(bytes32)", sourceIdA));
    }

    function observeB() external {
        _callExecutor(abi.encodeWithSignature("observeSource(bytes32)", sourceIdB));
    }

    function _callExecutor(bytes memory callData) private {
        (bool success, bytes memory reason) = EXECUTOR.call(callData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }
    }
}

contract CoreRevenueInvariantTest is StdInvariant, CoreTestBase {
    CoreStandardFeeSource internal sourceA;
    CoreStandardFeeSource internal sourceB;
    CoreRevenueInvariantHandler internal handler;
    bytes32 internal sourceIdA;
    bytes32 internal sourceIdB;

    function setUp() public override {
        super.setUp();
        sourceA = new CoreStandardFeeSource();
        sourceB = new CoreStandardFeeSource();
        sourceIdA = _register(address(sourceA), address(0));
        sourceIdB = _register(address(sourceB), address(0));
        handler = new CoreRevenueInvariantHandler(sourceA, sourceB, address(executor), sourceIdA, sourceIdB);
        targetContract(address(handler));
    }

    function invariant_eachNativeSourceIsConservedExactly() public view {
        uint256 accruedA = sourceA.accruedProgrammableFees(address(0));
        uint256 claimedA = sourceA.totalProgrammableFeesClaimed(address(0));
        uint256 accruedB = sourceB.accruedProgrammableFees(address(0));
        uint256 claimedB = sourceB.totalProgrammableFeesClaimed(address(0));
        assertEq(accruedA + claimedA, handler.totalAccruedA());
        assertEq(accruedB + claimedB, handler.totalAccruedB());
        assertEq(address(sourceA).balance, accruedA);
        assertEq(address(sourceB).balance, accruedB);
        assertEq(REWARD_WALLET.balance, claimedA + claimedB);
    }

    function invariant_executorLedgersNeverExceedSourceCounters() public view {
        _assertExecutorLedger(sourceA, sourceIdA);
        _assertExecutorLedger(sourceB, sourceIdB);

        uint256 observed = executor.totalObservedBySource(sourceIdA) + executor.totalObservedBySource(sourceIdB);
        uint256 executed = executor.totalExecutedBySource(sourceIdA) + executor.totalExecutedBySource(sourceIdB);
        assertEq(executor.totalObservedByAsset(address(0)), observed);
        assertEq(executor.totalExecutedByAsset(address(0)), executed);
    }

    function invariant_collectorNeverCustodiesClaimedNativeEth() public view {
        assertEq(address(collector).balance, 0);
    }

    function invariant_registryBindingsStayExecutableAndUnique() public view {
        assertEq(registry.sourceIdFor(address(sourceA), address(0)), sourceIdA);
        assertEq(registry.sourceIdFor(address(sourceB), address(0)), sourceIdB);
        assertTrue(registry.isExecutable(sourceIdA));
        assertTrue(registry.isExecutable(sourceIdB));
        assertNotEq(sourceIdA, sourceIdB);
    }

    function _assertExecutorLedger(CoreStandardFeeSource source, bytes32 sourceId) private view {
        uint256 cumulative = source.totalProgrammableFeesClaimed(address(0));
        uint256 observed = executor.lastObservedCumulative(sourceId);
        uint256 executed = executor.totalExecutedBySource(sourceId);
        assertEq(executor.totalObservedBySource(sourceId), observed);
        assertLe(executed, observed);
        assertLe(observed, cumulative);
    }
}
