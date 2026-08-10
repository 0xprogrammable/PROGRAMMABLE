// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { CoreMockERC20, CoreStandardFeeSource, CoreTestBase } from "./CoreTestBase.t.sol";

contract CoreRevenueInvariantHandler is Test {
    CoreStandardFeeSource public immutable nativeSource;
    CoreStandardFeeSource public immutable tokenSource;
    CoreMockERC20 public immutable token;
    bytes32 public immutable nativeSourceId;
    bytes32 public immutable tokenSourceId;

    address internal immutable EXECUTOR;

    uint256 public totalNativeAccrued;
    uint256 public totalTokenAccrued;

    constructor(
        CoreStandardFeeSource nativeSource_,
        CoreStandardFeeSource tokenSource_,
        CoreMockERC20 token_,
        address executor_,
        bytes32 nativeSourceId_,
        bytes32 tokenSourceId_
    ) {
        nativeSource = nativeSource_;
        tokenSource = tokenSource_;
        token = token_;
        EXECUTOR = executor_;
        nativeSourceId = nativeSourceId_;
        tokenSourceId = tokenSourceId_;
        token_.approve(address(tokenSource_), type(uint256).max);
    }

    function accrueNative(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 10 ether);
        vm.deal(address(this), address(this).balance + amount);
        nativeSource.accrueNative{ value: amount }();
        totalNativeAccrued += amount;
    }

    function accrueToken(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 10 ether);
        token.mint(address(this), amount);
        tokenSource.accrueToken(address(token), amount);
        totalTokenAccrued += amount;
    }

    function claimNative() external {
        _callExecutor(abi.encodeWithSignature("claimSource(bytes32)", nativeSourceId));
    }

    function claimToken() external {
        _callExecutor(abi.encodeWithSignature("claimSource(bytes32)", tokenSourceId));
    }

    function claimBatch(bool reverseOrder) external {
        bytes32[] memory sourceIds = new bytes32[](2);
        sourceIds[reverseOrder ? 1 : 0] = nativeSourceId;
        sourceIds[reverseOrder ? 0 : 1] = tokenSourceId;
        _callExecutor(abi.encodeWithSignature("claimBatch(bytes32[])", sourceIds));
    }

    function claimNativeDirectly() external {
        nativeSource.claimProgrammableFees(address(0));
    }

    function claimTokenDirectly() external {
        tokenSource.claimProgrammableFees(address(token));
    }

    function observeNative() external {
        _callExecutor(abi.encodeWithSignature("observeSource(bytes32)", nativeSourceId));
    }

    function observeToken() external {
        _callExecutor(abi.encodeWithSignature("observeSource(bytes32)", tokenSourceId));
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
    CoreStandardFeeSource internal nativeSource;
    CoreStandardFeeSource internal tokenSource;
    CoreMockERC20 internal token;
    CoreRevenueInvariantHandler internal handler;
    bytes32 internal nativeSourceId;
    bytes32 internal tokenSourceId;

    function setUp() public override {
        super.setUp();
        nativeSource = new CoreStandardFeeSource();
        tokenSource = new CoreStandardFeeSource();
        token = new CoreMockERC20();
        nativeSourceId = _register(address(nativeSource), address(0));
        tokenSourceId = _register(address(tokenSource), address(token));
        handler = new CoreRevenueInvariantHandler(
            nativeSource, tokenSource, token, address(executor), nativeSourceId, tokenSourceId
        );
        targetContract(address(handler));
    }

    function invariant_nativeAssetIsConservedExactly() public view {
        uint256 accrued = nativeSource.accruedProgrammableFees(address(0));
        uint256 claimed = nativeSource.totalProgrammableFeesClaimed(address(0));
        assertEq(accrued + claimed, handler.totalNativeAccrued());
        assertEq(address(nativeSource).balance, accrued);
        assertEq(REWARD_WALLET.balance, claimed);
    }

    function invariant_tokenAssetIsConservedExactly() public view {
        uint256 accrued = tokenSource.accruedProgrammableFees(address(token));
        uint256 claimed = tokenSource.totalProgrammableFeesClaimed(address(token));
        assertEq(accrued + claimed, handler.totalTokenAccrued());
        assertEq(token.balanceOf(address(tokenSource)), accrued);
        assertEq(token.balanceOf(REWARD_WALLET), claimed);
    }

    function invariant_executorLedgersNeverExceedSourceCounters() public view {
        _assertExecutorLedger(nativeSource, nativeSourceId, address(0));
        _assertExecutorLedger(tokenSource, tokenSourceId, address(token));
    }

    function invariant_collectorNeverCustodiesClaimedAssets() public view {
        assertEq(address(collector).balance, 0);
        assertEq(token.balanceOf(address(collector)), 0);
    }

    function invariant_registryBindingsStayExecutableAndUnique() public view {
        assertEq(registry.sourceIdFor(address(nativeSource), address(0)), nativeSourceId);
        assertEq(registry.sourceIdFor(address(tokenSource), address(token)), tokenSourceId);
        assertTrue(registry.isExecutable(nativeSourceId));
        assertTrue(registry.isExecutable(tokenSourceId));
    }

    function _assertExecutorLedger(CoreStandardFeeSource source, bytes32 sourceId, address asset) private view {
        uint256 cumulative = source.totalProgrammableFeesClaimed(asset);
        uint256 observed = executor.lastObservedCumulative(sourceId);
        uint256 executed = executor.totalExecutedBySource(sourceId);
        assertEq(executor.totalObservedBySource(sourceId), observed);
        assertLe(executed, observed);
        assertLe(observed, cumulative);
        assertEq(executor.totalObservedByAsset(asset), observed);
        assertEq(executor.totalExecutedByAsset(asset), executed);
    }
}
