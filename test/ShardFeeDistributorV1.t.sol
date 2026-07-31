// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ShardFeeDistributorV1 } from "../src/ShardFeeDistributorV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";

/// @dev Concrete shim exposing the internal accounting of ShardFeeDistributorV1.
///      Drives `_distribute` directly — the unsplit holder-pool entry point. The
///      builder/launcher carve happens one level up in `_distributeFee`, so every
///      expectation in this file is about the holder accumulator alone.
contract ShardFeeDistributorV1Harness is ShardFeeDistributorV1 {
    constructor(address _launcherFeeRecipient, address _builderFeeRecipient)
        ShardFeeDistributorV1(_launcherFeeRecipient, _builderFeeRecipient)
    { }

    function distribute(uint256 amount) external {
        _distribute(amount);
    }

    function acquire(uint256 tokenId, address to) external {
        _acquireAccounting(tokenId, to);
    }

    function release(uint256 tokenId, address from) external {
        _releaseAccounting(tokenId, from);
    }

    function settle(uint256 tokenId, address owner) external {
        _settle(tokenId, owner);
    }

    function claim(address account) external returns (uint256) {
        return _claim(account);
    }

    function flush() external {
        _flushPending();
    }

    // IShardHookV1
    function settleOnTransfer(uint256 tokenId, address from, address to) external override {
        _settle(tokenId, from);
        _releaseAccounting(tokenId, from);
        _acquireAccounting(tokenId, to);
    }

    receive() external payable { }
}

contract ShardFeeDistributorV1Test is Test {
    uint256 internal constant ACC = ShardConstantsV1.ACC_PRECISION;

    ShardFeeDistributorV1Harness internal d;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCAC0);

    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");

    function setUp() public {
        d = new ShardFeeDistributorV1Harness(launcher, builder);
        vm.deal(address(d), 1_000_000 ether);
        vm.roll(100);
    }

    // ------------------------------------------------------------------
    // escrow
    // ------------------------------------------------------------------

    function test_feesWithNoHoldersGoToEscrow() public {
        d.distribute(1 ether);

        assertEq(d.escrowBalance(), 1 ether, "escrow");
        assertEq(d.accFeePerNFT(), 0, "acc untouched");
        assertEq(d.circulating(), 0, "circulating");
    }

    function test_escrowFoldsInOnFirstDistributionWithHolders() public {
        d.distribute(1 ether);
        assertEq(d.escrowBalance(), 1 ether, "escrowed");

        // Acquiring does NOT fold the escrow in.
        d.acquire(1, alice);
        assertEq(d.escrowBalance(), 1 ether, "escrow survives acquire");
        assertEq(d.accFeePerNFT(), 0, "acc still zero");

        // The fold happens inside _distribute, once something circulates.
        vm.roll(block.number + 1);
        d.distribute(0);

        assertEq(d.escrowBalance(), 0, "escrow drained");
        assertEq(d.circulating(), 1, "flushed");
        assertEq(d.accFeePerNFT(), 1 ether * ACC, "acc credited with escrow");

        d.settle(1, alice);
        assertEq(d.claimable(alice), 1 ether, "alice paid the escrow");
    }

    // ------------------------------------------------------------------
    // splitting
    // ------------------------------------------------------------------

    function test_evenSplitAcrossHolders() public {
        d.acquire(1, alice);
        d.acquire(2, bob);
        d.acquire(3, carol);

        vm.roll(block.number + 1);
        d.distribute(3 ether);

        assertEq(d.circulating(), 3, "circulating");

        d.settle(1, alice);
        d.settle(2, bob);
        d.settle(3, carol);

        assertEq(d.claimable(alice), 1 ether, "alice");
        assertEq(d.claimable(bob), 1 ether, "bob");
        assertEq(d.claimable(carol), 1 ether, "carol");
        assertEq(d.dustScaled(), 0, "no dust");
    }

    /// @notice The same-block accrual guard: a token acquired in this block is excluded from
    ///         `circulating`, and `_settle` floors its snapshot at the accumulator recorded
    ///         when its acquisition block was flushed. Both halves are needed — the count
    ///         alone would let the pending token claim a rise it was never divided into.
    function test_sameBlockAcquisitionEarnsNothing() public {
        // alice is already earning
        d.acquire(1, alice);
        vm.roll(block.number + 1);
        d.flush();
        assertEq(d.circulating(), 1, "alice circulating");

        // bob acquires and a fee lands in the very same block
        d.acquire(2, bob);
        d.distribute(1 ether);

        d.settle(1, alice);
        d.settle(2, bob);

        assertEq(d.claimable(bob), 0, "bob earns nothing in his acquisition block");
        assertEq(d.claimable(alice), 1 ether, "alice takes the whole fee");
    }

    function test_holderEarnsFromNextBlockOnward() public {
        d.acquire(1, alice);
        vm.roll(block.number + 1);
        d.flush();

        d.acquire(2, bob);

        // block N: bob pending, alice takes everything
        d.distribute(1 ether);

        // block N+1: bob is in the earning set
        vm.roll(block.number + 1);
        d.distribute(2 ether);

        d.settle(1, alice);
        d.settle(2, bob);

        assertEq(d.circulating(), 2, "both circulating");
        assertEq(d.claimable(bob), 1 ether, "bob earns from the next block");
        assertEq(d.claimable(alice), 2 ether, "alice: all of #1, half of #2");
    }

    // ------------------------------------------------------------------
    // dust / fractions
    // ------------------------------------------------------------------

    function test_dustIsCarriedNotLost() public {
        d.acquire(1, alice);
        d.acquire(2, bob);
        d.acquire(3, carol);
        vm.roll(block.number + 1);

        // 3 x 1 wei across 3 holders: nothing may be stranded.
        d.distribute(1);
        assertEq(d.dustScaled(), 1, "dust carried in scaled units after #1");
        d.distribute(1);
        assertEq(d.dustScaled(), 2, "dust carried in scaled units after #2");
        d.distribute(1);
        assertEq(d.dustScaled(), 0, "dust consumed on #3");

        d.settle(1, alice);
        d.settle(2, bob);
        d.settle(3, carol);

        assertEq(d.claimable(alice), 1, "alice 1 wei");
        assertEq(d.claimable(bob), 1, "bob 1 wei");
        assertEq(d.claimable(carol), 1, "carol 1 wei");
        assertEq(d.claimable(alice) + d.claimable(bob) + d.claimable(carol), 3, "all 3 wei paid out");
    }

    function test_settlePreservesFractionalRemainder() public {
        d.acquire(1, alice);
        d.acquire(2, bob);
        d.acquire(3, carol);
        vm.roll(block.number + 1);

        // 300 x 1 wei, force-settling after every single one (as a transfer would).
        for (uint256 i = 0; i < 300; ++i) {
            d.distribute(1);
            d.settle(1, alice);
            d.settle(2, bob);
            d.settle(3, carol);
        }

        assertEq(d.claimable(alice), 100, "alice keeps her truncated fractions");
        assertEq(d.claimable(bob), 100, "bob");
        assertEq(d.claimable(carol), 100, "carol");
        assertEq(d.dustScaled(), 0, "dust fully consumed");
    }

    // ------------------------------------------------------------------
    // release
    // ------------------------------------------------------------------

    function test_releaseSettlesToOutgoingOwner() public {
        d.acquire(1, alice);
        vm.roll(block.number + 1);
        d.distribute(1 ether);

        d.release(1, alice);

        assertEq(d.claimable(alice), 1 ether, "outgoing owner settled");
        assertEq(d.circulating(), 0, "left the earning set");
        assertEq(d.pendingCount(), 0, "no pending");
    }

    function test_acquireAndReleaseInSameBlockDoesNotCorruptCount() public {
        d.acquire(1, alice);
        vm.roll(block.number + 1);
        d.flush();
        assertEq(d.circulating(), 1, "baseline");

        d.acquire(2, bob);
        assertEq(d.pendingCount(), 1, "bob pending");

        d.release(2, bob);

        assertEq(d.pendingCount(), 0, "pending decremented, not circulating");
        assertEq(d.circulating(), 1, "alice untouched");

        // and the earning set is still sane a block later
        vm.roll(block.number + 1);
        d.distribute(1 ether);
        d.settle(1, alice);
        assertEq(d.circulating(), 1, "still one");
        assertEq(d.claimable(alice), 1 ether, "alice takes it all");
    }

    /// @notice Path 3 — the realistic exploit. In production `_settle` is reached through
    ///         an ERC-721 transfer: `settleOnTransfer` settles `from` before any release.
    ///         Buy in block N, swap in block N, transfer in block N. ShardFeeDistributorV1 has
    ///         no ERC-721 of its own, so the transfer's settle leg is called directly here.
    function test_transferInAcquisitionBlockEarnsNothing() public {
        d.acquire(1, alice);
        vm.roll(block.number + 1);
        d.flush();
        assertEq(d.circulating(), 1, "alice earning");

        d.acquire(2, bob);
        d.distribute(1 ether); // divided by 1: alice only

        // bob transfers token 2 to carol in his own acquisition block
        d.settle(2, bob);

        d.settle(1, alice);

        assertEq(d.claimable(bob), 0, "pending token accrues nothing on transfer");
        assertEq(d.claimable(carol), 0, "carol acquires nothing retroactively");
        assertEq(d.claimable(alice), 1 ether, "alice takes the whole fee");
        assertLe(d.claimable(alice) + d.claimable(bob) + d.claimable(carol), 1 ether, "solvent: claims <= fees");
    }

    /// @notice Path 2: acquired AND released inside one block, with a fee landing between.
    ///         The token never joined the earning set, so `flushAcc[thatBlock]` is never
    ///         written and cannot floor anything — release must skip settlement outright.
    function test_acquireAndReleaseInSameBlockWithDistributionEarnsNothing() public {
        d.acquire(1, alice);
        vm.roll(block.number + 1);
        d.flush();
        assertEq(d.circulating(), 1, "alice earning");

        d.acquire(2, bob);
        d.distribute(1 ether); // divided by 1: alice only
        d.release(2, bob);

        d.settle(1, alice);

        assertEq(d.claimable(bob), 0, "bob never joined: earns nothing");
        assertEq(d.claimable(alice), 1 ether, "alice takes the whole fee");
        assertLe(d.claimable(alice) + d.claimable(bob), 1 ether, "solvent: claims <= fees");
        assertEq(d.circulating(), 1, "count intact");
        assertEq(d.pendingCount(), 0, "pending cleared");
    }

    /// @notice Regression: releasing a token acquired in an EARLIER block while a
    ///         DIFFERENT token is pending in THIS block must decrement `circulating`,
    ///         never `pendingCount`. Keying on a global `pendingBlock` would let bob
    ///         become the sole circulating holder in his own acquisition block and
    ///         collect the entire fee.
    function test_releaseOlderTokenWhileNewerIsPending() public {
        // block N
        d.acquire(1, alice);

        // block N+1
        vm.roll(block.number + 1);
        d.acquire(2, bob); // flush moves token 1 into circulating
        assertEq(d.circulating(), 1, "token 1 flushed in");
        assertEq(d.pendingCount(), 1, "token 2 pending");

        d.release(1, alice);
        assertEq(d.pendingCount(), 1, "token 2 must STILL be pending");
        assertEq(d.circulating(), 0, "token 1 left the earning set");

        d.distribute(10 ether);

        d.settle(2, bob);
        assertEq(d.claimable(bob), 0, "bob acquired this very block: earns nothing");
        assertEq(d.claimable(alice), 0, "alice already left");
        assertEq(d.escrowBalance(), 10 ether, "nothing circulating: escrowed");
        assertEq(d.accFeePerNFT(), 0, "acc untouched");
    }

    // ------------------------------------------------------------------
    // conservation
    // ------------------------------------------------------------------

    /// @dev A token's effective snapshot: it may never earn from before it joined the
    ///      earning set, so the acquire-time snapshot is floored by the accumulator
    ///      recorded when its acquisition block was flushed.
    function _effSnap(uint256 tokenId) internal view returns (uint256) {
        uint256 snap = d.feeSnapshot(tokenId);
        uint256 floor_ = d.flushAcc(d.acquiredBlock(tokenId));
        return floor_ > snap ? floor_ : snap;
    }

    function _paid() internal view returns (uint256) {
        return d.claimable(alice) + d.claimable(bob) + d.claimable(carol);
    }

    /// @dev THE property that actually matters: the contract can always honour every
    ///      claim it has issued. Checked after every single step.
    function _assertSolvent(uint256 total, string memory tag) internal view {
        assertLe(_paid() + d.dustScaled() / ACC + d.escrowBalance(), total, tag);
    }

    /// @dev Every wei distributed is either paid out, still escrowed, held as scaled dust,
    ///      held as an unsettled sub-wei fraction on a token, or discarded by the
    ///      re-snapshot that `_acquireAccounting` performs on a token settled at release.
    ///      All terms are accounted in SCALED units so the check is exact.
    ///
    ///      This fuzz distributes FREELY inside acquisition blocks and settles inside them
    ///      too — no ordering restriction that could hide a same-block double-credit.
    function testFuzz_totalDistributedIsConserved(uint96 a1, uint96 a2, uint96 a3, uint96 a4) public {
        uint256 total;

        // Block N: fees land with nothing circulating AND acquisitions in the same block.
        d.acquire(1, alice);
        d.acquire(2, bob);
        d.distribute(a1);
        total += a1;
        _assertSolvent(total, "solvency: escrow block");

        // Block N+1: carol acquires and a fee lands in her acquisition block.
        vm.roll(block.number + 1);
        d.acquire(3, carol);
        d.distribute(a2);
        total += a2;
        d.settle(1, alice);
        d.settle(2, bob);
        d.settle(3, carol);
        _assertSolvent(total, "solvency: fee in carol's acquisition block");

        // Block N+2: everyone earning.
        vm.roll(block.number + 1);
        d.distribute(a3);
        total += a3;
        d.settle(1, alice);
        d.settle(2, bob);
        d.settle(3, carol);
        _assertSolvent(total, "solvency: steady state");

        // Same block: release and re-acquire token 1, then a fee lands and is settled
        // while token 1 is pending again.
        d.release(1, alice);
        uint256 discardedScaled = d.accFeePerNFT() - _effSnap(1);
        d.acquire(1, alice);
        d.distribute(a4);
        total += a4;
        d.settle(1, alice);
        d.settle(2, bob);
        d.settle(3, carol);
        _assertSolvent(total, "solvency: fee in token 1's re-acquisition block");

        // Next block: token 1 rejoins, everything settles out.
        vm.roll(block.number + 1);
        d.flush();
        d.settle(1, alice);
        d.settle(2, bob);
        d.settle(3, carol);
        _assertSolvent(total, "solvency: final");

        uint256 acc = d.accFeePerNFT();
        uint256 unsettledScaled = (acc - _effSnap(1)) + (acc - _effSnap(2)) + (acc - _effSnap(3));

        assertEq(d.circulating(), 3, "all three earning");
        assertEq(
            _paid() * ACC + unsettledScaled + discardedScaled + d.dustScaled() + d.escrowBalance() * ACC,
            total * ACC,
            "no wei created or destroyed"
        );
    }

    /// @dev The split lives one level up, in `_distributeFee`. Nothing this suite drives
    ///      through `_distribute` may ever touch the beneficiary accruals.
    function test_distributeNeverAccruesToBuilderOrLauncher() public {
        d.acquire(1, alice);
        vm.roll(block.number + 1);
        d.distribute(1 ether);

        assertEq(d.builderFeesAccrued(), 0, "builder accrued from _distribute");
        assertEq(d.launcherFeesAccrued(), 0, "launcher accrued from _distribute");
    }
}
