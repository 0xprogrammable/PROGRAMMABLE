// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Vm } from "forge-std/Vm.sol";

import { ProtocolRevenueCollectorV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueCollectorV1.sol";
import { ProtocolRevenueClaimExecutorV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueClaimExecutorV1.sol";
import {
    CoreBombFeeSource,
    CoreBombBalanceERC20,
    CoreFaultyFeeSource,
    CoreFeeOnTransferERC20,
    CoreMockERC20,
    CoreStandardFeeSource,
    CoreTestBase
} from "./CoreTestBase.t.sol";

contract CoreReentrantRewardWallet {
    ProtocolRevenueClaimExecutorV1 internal immutable EXECUTOR;
    bytes32 internal immutable SOURCE_ID;

    uint256 public attempts;
    bytes4 public lastErrorSelector;

    constructor(ProtocolRevenueClaimExecutorV1 executor_, bytes32 sourceId_) {
        EXECUTOR = executor_;
        SOURCE_ID = sourceId_;
    }

    receive() external payable {
        ++attempts;
        try EXECUTOR.claimSource(SOURCE_ID) returns (uint256) { }
        catch (bytes memory reason) {
            if (reason.length >= 4) {
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(reason, 0x20))
                }
                lastErrorSelector = selector;
            }
        }
    }
}

contract CoreForceNative {
    constructor() payable { }

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

contract CoreExecutorTest is CoreTestBase {
    function test_sourceClaimEmitsExactCanonicalEventAndEmptyClaimEmitsNone() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        source.accrueNative{ value: 0.23 ether }();
        address outsider = makeAddr("canonicalEventCaller");

        vm.recordLogs();
        vm.prank(outsider);
        assertEq(source.claimProgrammableFees(address(0)), 0.23 ether);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(logs.length, 1);
        assertEq(logs[0].emitter, address(source));
        assertEq(logs[0].topics.length, 4);
        assertEq(logs[0].topics[0], keccak256("ProgrammableFeesClaimed(address,address,address,uint256)"));
        assertEq(logs[0].topics[1], bytes32(0));
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(REWARD_WALLET))));
        assertEq(logs[0].topics[3], bytes32(uint256(uint160(outsider))));
        assertEq(abi.decode(logs[0].data, (uint256)), 0.23 ether);

        vm.recordLogs();
        assertEq(source.claimProgrammableFees(address(0)), 0);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(source.accruedProgrammableFees(address(0)), 0);
        assertEq(source.totalProgrammableFeesClaimed(address(0)), 0.23 ether);
        assertEq(REWARD_WALLET.balance, 0.23 ether);
    }

    function test_claimsNativeRevenueDirectlyToFixedRewardWallet() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: 0.35 ether }();

        uint256 claimed = executor.claimSource(sourceId);

        assertEq(claimed, 0.35 ether);
        assertEq(REWARD_WALLET.balance, 0.35 ether);
        assertEq(address(collector).balance, 0);
        assertEq(source.accruedProgrammableFees(address(0)), 0);
        assertEq(source.totalProgrammableFeesClaimed(address(0)), 0.35 ether);
        assertEq(executor.lastObservedCumulative(sourceId), 0.35 ether);
        assertEq(executor.totalObservedBySource(sourceId), 0.35 ether);
        assertEq(executor.totalObservedByAsset(address(0)), 0.35 ether);
        assertEq(executor.totalExecutedBySource(sourceId), 0.35 ether);
        assertEq(executor.totalExecutedByAsset(address(0)), 0.35 ether);
    }

    function test_claimsErc20RevenueUsingActualRewardWalletDelta() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        CoreMockERC20 token = new CoreMockERC20();
        bytes32 sourceId = _register(address(source), address(token));
        token.mint(address(this), 900 ether);
        token.approve(address(source), 900 ether);
        source.accrueToken(address(token), 900 ether);

        uint256 claimed = executor.claimSource(sourceId);

        assertEq(claimed, 900 ether);
        assertEq(token.balanceOf(REWARD_WALLET), 900 ether);
        assertEq(token.balanceOf(address(collector)), 0);
        assertEq(executor.totalExecutedByAsset(address(token)), 900 ether);
        assertEq(executor.totalObservedByAsset(address(token)), 900 ether);
    }

    function test_observesPermissionlessThirdPartyClaimCounterWithoutDoubleCounting() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: 0.42 ether }();

        address outsider = makeAddr("permissionlessClaimer");
        vm.prank(outsider);
        source.claimProgrammableFees(address(0));
        assertEq(REWARD_WALLET.balance, 0.42 ether);
        assertEq(executor.totalObservedBySource(sourceId), 0);

        uint256 observed = executor.observeSource(sourceId);
        assertEq(observed, 0.42 ether);
        assertEq(executor.lastObservedCumulative(sourceId), 0.42 ether);
        assertEq(executor.totalObservedBySource(sourceId), 0.42 ether);
        assertEq(executor.totalExecutedBySource(sourceId), 0);
        assertEq(executor.observeSource(sourceId), 0);
    }

    function test_batchIsolatesRevertingSourceAndStillClaimsHealthySource() public {
        CoreFaultyFeeSource faulty = new CoreFaultyFeeSource();
        CoreStandardFeeSource healthy = new CoreStandardFeeSource();
        bytes32 faultyId = _register(address(faulty), address(0));
        bytes32 healthyId = _register(address(healthy), address(0));
        faulty.accrueNative{ value: 0.2 ether }();
        healthy.accrueNative{ value: 0.3 ether }();
        faulty.setMode(CoreFaultyFeeSource.Mode.RevertClaim);

        bytes32[] memory sourceIds = new bytes32[](2);
        sourceIds[0] = faultyId;
        sourceIds[1] = healthyId;
        (uint256 succeeded, uint256 failed) = executor.claimBatch(sourceIds);

        assertEq(succeeded, 1);
        assertEq(failed, 1);
        assertEq(REWARD_WALLET.balance, 0.3 ether);
        assertEq(faulty.accruedProgrammableFees(address(0)), 0.2 ether);
        assertEq(healthy.accruedProgrammableFees(address(0)), 0);
        assertEq(executor.totalExecutedBySource(faultyId), 0);
        assertEq(executor.totalExecutedBySource(healthyId), 0.3 ether);
    }

    function test_batchRollsBackPartialSourceAndContinues() public {
        CoreFaultyFeeSource partialSource = new CoreFaultyFeeSource();
        CoreStandardFeeSource healthy = new CoreStandardFeeSource();
        bytes32 partialId = _register(address(partialSource), address(0));
        bytes32 healthyId = _register(address(healthy), address(0));
        partialSource.accrueNative{ value: 0.4 ether }();
        healthy.accrueNative{ value: 0.1 ether }();
        partialSource.setMode(CoreFaultyFeeSource.Mode.PartialClaim);

        bytes32[] memory sourceIds = new bytes32[](2);
        sourceIds[0] = partialId;
        sourceIds[1] = healthyId;
        (uint256 succeeded, uint256 failed) = executor.claimBatch(sourceIds);

        assertEq(succeeded, 1);
        assertEq(failed, 1);
        assertEq(partialSource.accruedProgrammableFees(address(0)), 0.4 ether);
        assertEq(partialSource.totalProgrammableFeesClaimed(address(0)), 0);
        assertEq(REWARD_WALLET.balance, 0.1 ether);
        assertEq(executor.totalExecutedBySource(partialId), 0);
    }

    function test_batchRejectsMisreportNoTransferAndCounterMismatchIndependently() public {
        CoreFaultyFeeSource misreport = new CoreFaultyFeeSource();
        CoreFaultyFeeSource noTransfer = new CoreFaultyFeeSource();
        CoreFaultyFeeSource counterMismatch = new CoreFaultyFeeSource();
        bytes32 misreportId = _register(address(misreport), address(0));
        bytes32 noTransferId = _register(address(noTransfer), address(0));
        bytes32 counterMismatchId = _register(address(counterMismatch), address(0));
        misreport.accrueNative{ value: 0.11 ether }();
        noTransfer.accrueNative{ value: 0.12 ether }();
        counterMismatch.accrueNative{ value: 0.13 ether }();
        misreport.setMode(CoreFaultyFeeSource.Mode.Misreport);
        noTransfer.setMode(CoreFaultyFeeSource.Mode.NoTransfer);
        counterMismatch.setMode(CoreFaultyFeeSource.Mode.CounterMismatch);

        bytes32[] memory sourceIds = new bytes32[](3);
        sourceIds[0] = misreportId;
        sourceIds[1] = noTransferId;
        sourceIds[2] = counterMismatchId;
        (uint256 succeeded, uint256 failed) = executor.claimBatch(sourceIds);

        assertEq(succeeded, 0);
        assertEq(failed, 3);
        assertEq(REWARD_WALLET.balance, 0);
        assertEq(misreport.accruedProgrammableFees(address(0)), 0.11 ether);
        assertEq(noTransfer.accruedProgrammableFees(address(0)), 0.12 ether);
        assertEq(counterMismatch.accruedProgrammableFees(address(0)), 0.13 ether);
    }

    function test_batchBoundsReturnAndRevertBombsAndContinues() public {
        CoreBombFeeSource returnBomb = new CoreBombFeeSource();
        CoreBombFeeSource revertBomb = new CoreBombFeeSource();
        CoreStandardFeeSource healthy = new CoreStandardFeeSource();
        bytes32 returnBombId = _register(address(returnBomb), address(0));
        bytes32 revertBombId = _register(address(revertBomb), address(0));
        bytes32 healthyId = _register(address(healthy), address(0));
        returnBomb.accrueNative{ value: 0.11 ether }();
        revertBomb.accrueNative{ value: 0.12 ether }();
        healthy.accrueNative{ value: 0.13 ether }();
        returnBomb.setMode(CoreBombFeeSource.Mode.ReturnBomb);
        revertBomb.setMode(CoreBombFeeSource.Mode.RevertBomb);

        bytes32[] memory sourceIds = new bytes32[](3);
        sourceIds[0] = returnBombId;
        sourceIds[1] = revertBombId;
        sourceIds[2] = healthyId;
        (uint256 succeeded, uint256 failed) = executor.claimBatch(sourceIds);

        assertEq(succeeded, 1);
        assertEq(failed, 2);
        assertEq(REWARD_WALLET.balance, 0.13 ether);
        assertEq(returnBomb.accruedProgrammableFees(address(0)), 0.11 ether);
        assertEq(revertBomb.accruedProgrammableFees(address(0)), 0.12 ether);
        assertEq(executor.totalExecutedBySource(healthyId), 0.13 ether);
    }

    function test_batchRejectsMalformedRecipientEncodingAndContinues() public {
        CoreBombFeeSource malformed = new CoreBombFeeSource();
        CoreStandardFeeSource healthy = new CoreStandardFeeSource();
        bytes32 malformedId = _register(address(malformed), address(0));
        bytes32 healthyId = _register(address(healthy), address(0));
        malformed.accrueNative{ value: 0.14 ether }();
        healthy.accrueNative{ value: 0.15 ether }();
        malformed.setMode(CoreBombFeeSource.Mode.MalformedRecipient);

        bytes32[] memory sourceIds = new bytes32[](2);
        sourceIds[0] = malformedId;
        sourceIds[1] = healthyId;
        (uint256 succeeded, uint256 failed) = executor.claimBatch(sourceIds);

        assertEq(succeeded, 1);
        assertEq(failed, 1);
        assertEq(REWARD_WALLET.balance, 0.15 ether);
        assertEq(malformed.accruedProgrammableFees(address(0)), 0.14 ether);
    }

    function test_batchBoundsMaliciousTokenBalanceReturnDataAndContinues() public {
        CoreStandardFeeSource malformedAssetSource = new CoreStandardFeeSource();
        CoreStandardFeeSource healthy = new CoreStandardFeeSource();
        CoreBombBalanceERC20 malformedAsset = new CoreBombBalanceERC20();
        bytes32 malformedId = _register(address(malformedAssetSource), address(malformedAsset));
        bytes32 healthyId = _register(address(healthy), address(0));
        malformedAsset.mint(address(this), 20 ether);
        malformedAsset.approve(address(malformedAssetSource), 20 ether);
        malformedAssetSource.accrueToken(address(malformedAsset), 20 ether);
        healthy.accrueNative{ value: 0.16 ether }();
        malformedAsset.setMode(CoreBombBalanceERC20.Mode.ReturnBomb);

        bytes32[] memory sourceIds = new bytes32[](2);
        sourceIds[0] = malformedId;
        sourceIds[1] = healthyId;
        (uint256 succeeded, uint256 failed) = executor.claimBatch(sourceIds);

        assertEq(succeeded, 1);
        assertEq(failed, 1);
        assertEq(malformedAssetSource.accruedProgrammableFees(address(malformedAsset)), 20 ether);
        assertEq(REWARD_WALLET.balance, 0.16 ether);
    }

    function test_batchTreatsDuplicateAsFailureWithoutSecondClaim() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: 0.17 ether }();
        bytes32[] memory sourceIds = new bytes32[](2);
        sourceIds[0] = sourceId;
        sourceIds[1] = sourceId;

        (uint256 succeeded, uint256 failed) = executor.claimBatch(sourceIds);

        assertEq(succeeded, 1);
        assertEq(failed, 1);
        assertEq(REWARD_WALLET.balance, 0.17 ether);
        assertEq(executor.totalExecutedBySource(sourceId), 0.17 ether);
    }

    function test_batchRejectsMoreThanEightEntries() public {
        bytes32[] memory sourceIds = new bytes32[](executor.MAX_BATCH_SIZE() + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueClaimExecutorV1.BatchTooLarge.selector, sourceIds.length, executor.MAX_BATCH_SIZE()
            )
        );
        executor.claimBatch(sourceIds);
    }

    function test_quarantineStopsClaimsWithoutMutatingSourceBinding() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: 0.09 ether }();
        vm.prank(quarantiner);
        registry.quarantineSource(sourceId, keccak256("runtime-review"));

        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueClaimExecutorV1.SourceQuarantined.selector, sourceId));
        executor.claimSource(sourceId);
        assertEq(source.accruedProgrammableFees(address(0)), 0.09 ether);
        assertEq(REWARD_WALLET.balance, 0);
    }

    function test_postActivationRuntimeCodeDriftStopsClaimBeforeExternalCall() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: 0.16 ether }();
        bytes32 expectedCodeHash = address(source).codehash;
        vm.etch(address(source), hex"60006000fd");

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueClaimExecutorV1.SourceRuntimeCodeHashMismatch.selector,
                sourceId,
                expectedCodeHash,
                address(source).codehash
            )
        );
        executor.claimSource(sourceId);
        assertEq(REWARD_WALLET.balance, 0);
    }

    function test_postActivationAssetCodeLossIsIntegrityFailureNotEmptyClaim() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        CoreMockERC20 token = new CoreMockERC20();
        bytes32 sourceId = _register(address(source), address(token));
        vm.etch(address(token), bytes(""));

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueClaimExecutorV1.SourceAssetCodeMissing.selector, sourceId, address(token)
            )
        );
        executor.claimSource(sourceId);
        assertEq(executor.totalObservedBySource(sourceId), 0);
        assertEq(executor.totalExecutedBySource(sourceId), 0);
    }

    function test_feeOnTransferAssetFailsClosedWithoutBlockingHealthySource() public {
        CoreStandardFeeSource unsupportedSource = new CoreStandardFeeSource();
        CoreStandardFeeSource healthy = new CoreStandardFeeSource();
        CoreFeeOnTransferERC20 feeToken = new CoreFeeOnTransferERC20();
        bytes32 unsupportedId = _register(address(unsupportedSource), address(feeToken));
        bytes32 healthyId = _register(address(healthy), address(0));
        feeToken.mint(address(this), 100 ether);
        feeToken.approve(address(unsupportedSource), 100 ether);
        unsupportedSource.accrueToken(address(feeToken), 100 ether);
        healthy.accrueNative{ value: 0.18 ether }();
        assertEq(feeToken.balanceOf(address(unsupportedSource)), 99 ether);

        bytes32[] memory sourceIds = new bytes32[](2);
        sourceIds[0] = unsupportedId;
        sourceIds[1] = healthyId;
        (uint256 succeeded, uint256 failed) = executor.claimBatch(sourceIds);

        assertEq(succeeded, 1);
        assertEq(failed, 1);
        assertEq(unsupportedSource.accruedProgrammableFees(address(feeToken)), 100 ether);
        assertEq(feeToken.balanceOf(REWARD_WALLET), 0);
        assertEq(REWARD_WALLET.balance, 0.18 ether);
    }

    function test_rewardWalletCallbackCannotReenterClaimExecutor() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        CoreReentrantRewardWallet implementation = new CoreReentrantRewardWallet(executor, sourceId);
        vm.etch(REWARD_WALLET, address(implementation).code);
        source.accrueNative{ value: 0.19 ether }();

        assertEq(executor.claimSource(sourceId), 0.19 ether);

        CoreReentrantRewardWallet wallet = CoreReentrantRewardWallet(payable(REWARD_WALLET));
        assertEq(wallet.attempts(), 1);
        assertEq(wallet.lastErrorSelector(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(REWARD_WALLET.balance, 0.19 ether);
        assertEq(source.accruedProgrammableFees(address(0)), 0);
        assertEq(source.totalProgrammableFeesClaimed(address(0)), 0.19 ether);
    }

    function test_collectorForwardsForcedNativeAndStrayTokenOnlyToRewardWallet() public {
        CoreForceNative forceNative = new CoreForceNative{ value: 0.25 ether }();
        forceNative.force(payable(address(collector)));
        assertEq(address(collector).balance, 0.25 ether);
        collector.forwardStrayAsset(address(0));
        assertEq(address(collector).balance, 0);
        assertEq(REWARD_WALLET.balance, 0.25 ether);

        CoreMockERC20 token = new CoreMockERC20();
        token.mint(address(collector), 15 ether);
        collector.forwardStrayAsset(address(token));
        assertEq(token.balanceOf(address(collector)), 0);
        assertEq(token.balanceOf(REWARD_WALLET), 15 ether);
    }

    function test_emptyStandardClaimIsIdempotent() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        assertEq(source.claimProgrammableFees(address(0)), 0);
        assertEq(executor.claimSource(sourceId), 0);
        assertEq(executor.totalObservedBySource(sourceId), 0);
        assertEq(executor.totalExecutedBySource(sourceId), 0);
    }

    function testFuzz_nativeClaimConservesExactAmount(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, 50 ether);
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        source.accrueNative{ value: amount }();

        assertEq(executor.claimSource(sourceId), amount);
        assertEq(REWARD_WALLET.balance, amount);
        assertEq(executor.totalObservedByAsset(address(0)), amount);
        assertEq(executor.totalExecutedByAsset(address(0)), amount);
    }
}
