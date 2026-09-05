// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ProgrammableLateMigrationIntakeV3 } from "../../src/late-migration/ProgrammableLateMigrationIntakeV3.sol";
import { ProgrammableLateMigrationIntakeV3Harness } from "./ProgrammableLateMigrationIntakeV3.t.sol";
import { PinnedPermitTokenMockV3 } from "./mocks/IntakeV3Mocks.sol";

/// @dev Generated-key fixture spans every bitmap word and the last valid offer index.
library IntakeInvariantFixture {
    function index(uint256 position) internal pure returns (uint256) {
        uint256[8] memory indices = [uint256(0), 255, 256, 511, 512, 1023, 1280, 1498];
        return indices[position];
    }

    function amount(uint256 position) internal pure returns (uint256) {
        return (position + 1) * 13 ether + position + 2;
    }
}

contract IntakeV3InvariantHandler is Test {
    ProgrammableLateMigrationIntakeV3 public immutable intake;
    PinnedPermitTokenMockV3 public immutable token;
    bytes32[15] internal tree;
    bool[8] public deposited;
    uint256[8] public capital;
    uint256[8] public depositBlocks;
    uint256 public successfulCalls;
    uint256 public rejectedCalls;
    address internal constant WITHDRAWAL = address(0xBAD);

    constructor(ProgrammableLateMigrationIntakeV3 target, PinnedPermitTokenMockV3 oldToken, bytes32[15] memory nodes) {
        intake = target;
        token = oldToken;
        tree = nodes;
        for (uint256 i; i < 8; ++i) {
            capital[i] = IntakeInvariantFixture.amount(i) * 3;
        }
    }

    function offer(uint256 i) public pure returns (ProgrammableLateMigrationIntakeV3.Offer memory) {
        uint256 gross = IntakeInvariantFixture.amount(i);
        return ProgrammableLateMigrationIntakeV3.Offer(
            IntakeInvariantFixture.index(i), vm.addr(i + 1), gross, (gross / 5) * 4 + (gross % 5) * 4 / 5
        );
    }

    function proof(uint256 i) public view returns (bytes32[] memory result) {
        result = new bytes32[](3);
        uint256 node = 7 + i;
        for (uint256 p; node > 0; ++p) {
            result[p] = tree[node % 2 == 0 ? node - 1 : node + 1];
            node = (node - 1) / 2;
        }
    }

    function topUp(uint256 seed, uint96 value) external {
        uint256 i = seed % 8;
        token.mint(vm.addr(i + 1), value);
        capital[i] += value;
    }

    function withdraw(uint256 seed, uint256 value) external {
        uint256 i = seed % 8;
        address source = vm.addr(i + 1);
        value = bound(value, 0, token.balanceOf(source));
        vm.prank(source);
        token.transfer(WITHDRAWAL, value);
        capital[i] -= value;
    }

    function submit(uint256 seed, uint8 variant, bool frontRunPermit) external {
        uint256 i = seed % 8;
        uint256 mode = variant % 7;
        ProgrammableLateMigrationIntakeV3.Offer memory supplied = offer(i);
        bytes32[] memory suppliedProof = proof(i);
        uint256 nonce = token.nonces(supplied.source);
        uint256 deadline = block.timestamp + 10 minutes;
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(i + 1, intake.permitDigest(supplied.source, supplied.grossAmount, nonce, deadline));
        if (frontRunPermit) token.permit(supplied.source, address(intake), supplied.grossAmount, deadline, v, r, s);
        if (mode == 1) token.setFeeOnTransfer(true);
        if (mode == 2) token.setForceTransferFromFalse(true);
        if (mode == 3) r = bytes32(uint256(r) ^ 1);
        if (mode == 4) suppliedProof[0] = bytes32(uint256(suppliedProof[0]) ^ 1);
        if (mode == 5) deadline = block.timestamp - 1;
        if (mode == 6) token.setExtraSourceDebit(true);
        bytes32 stateBefore = stateHash(i);
        uint256 balanceBefore = token.balanceOf(supplied.source);
        uint256 recipientBefore = token.balanceOf(intake.OLD_TOKEN_RECIPIENT());
        (bool success,) = address(intake)
            .call(abi.encodeCall(intake.depositWithPermit, (supplied, suppliedProof, nonce, deadline, v, r, s)));
        if (success) {
            assertEq(mode, 0, "an adversarial deposit succeeded");
            assertFalse(deposited[i], "a consumed source replayed");
            assertEq(balanceBefore - token.balanceOf(supplied.source), supplied.grossAmount);
            assertEq(token.balanceOf(intake.OLD_TOKEN_RECIPIENT()) - recipientBefore, supplied.grossAmount);
            assertEq(token.nonces(supplied.source), nonce + 1);
            assertEq(token.allowance(supplied.source, address(intake)), 0);
            deposited[i] = true;
            depositBlocks[i] = block.number;
            ++successfulCalls;
        } else {
            assertEq(stateHash(i), stateBefore, "a rejected deposit changed state or token balances");
            ++rejectedCalls;
        }
        token.setFeeOnTransfer(false);
        token.setForceTransferFromFalse(false);
        token.setExtraSourceDebit(false);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
    }

    function stateHash(uint256 i) public view returns (bytes32) {
        ProgrammableLateMigrationIntakeV3.Offer memory supplied = offer(i);
        return keccak256(
            abi.encode(
                intake.depositedOfferCount(),
                intake.depositedGrossTotal(),
                intake.depositedPayoutTotal(),
                intake.consumedSource(supplied.source),
                intake.isOfferDeposited(supplied.offerIndex),
                intake.acceptedDepositId(supplied.offerIndex),
                intake.depositedAtBlock(supplied.offerIndex),
                token.nonces(supplied.source),
                token.allowance(supplied.source, address(intake)),
                token.balanceOf(supplied.source),
                token.balanceOf(intake.OLD_TOKEN_RECIPIENT()),
                token.balanceOf(token.FEE_SINK())
            )
        );
    }
}

/// @dev Properties: one deposit per source/index; exact balance conservation; per-wallet floor rounding;
///      bitmap/identity/accounting agreement; atomic rejection; immutable activation; no token custody.
contract ProgrammableLateMigrationIntakeV3InvariantTest is Test {
    ProgrammableLateMigrationIntakeV3Harness internal intake;
    PinnedPermitTokenMockV3 internal token;
    IntakeV3InvariantHandler internal handler;

    function setUp() public {
        vm.chainId(1);
        vm.warp(1_800_000_000);
        vm.roll(10_000);
        address oldToken = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
        vm.etch(oldToken, address(new PinnedPermitTokenMockV3()).code);
        token = PinnedPermitTokenMockV3(oldToken);
        bytes32[15] memory tree;
        bytes32 round = 0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179;
        for (uint256 i; i < 8; ++i) {
            uint256 gross = IntakeInvariantFixture.amount(i);
            uint256 payout = (gross / 5) * 4 + (gross % 5) * 4 / 5;
            tree[7 + i] = keccak256(
                bytes.concat(
                    keccak256(abi.encode(round, IntakeInvariantFixture.index(i), vm.addr(i + 1), gross, payout))
                )
            );
            token.mint(vm.addr(i + 1), gross * 3);
        }
        for (uint256 i = 7; i > 0;) {
            --i;
            bytes32 a = tree[2 * i + 1];
            bytes32 b = tree[2 * i + 2];
            tree[i] = a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
        }
        intake = new ProgrammableLateMigrationIntakeV3Harness(address(this), tree[0]);
        intake.activateDeposits();
        handler = new IntakeV3InvariantHandler(intake, token, tree);
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.submit.selector;
        selectors[1] = handler.topUp.selector;
        selectors[2] = handler.withdraw.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariantAccountingAndBitmapAreConserved() public view {
        uint256 count;
        uint256 gross;
        uint256 payout;
        uint256[6] memory bitmap;
        for (uint256 i; i < 8; ++i) {
            ProgrammableLateMigrationIntakeV3.Offer memory supplied = handler.offer(i);
            bool done = handler.deposited(i);
            assertEq(intake.consumedSource(supplied.source), done);
            assertEq(intake.isOfferDeposited(supplied.offerIndex), done);
            assertEq(intake.depositedAtBlock(supplied.offerIndex), handler.depositBlocks(i));
            assertEq(token.balanceOf(supplied.source), handler.capital(i) - (done ? supplied.grossAmount : 0));
            if (done) {
                ++count;
                gross += supplied.grossAmount;
                payout += supplied.payoutAmount;
                bitmap[supplied.offerIndex >> 8] |= uint256(1) << (supplied.offerIndex & 255);
                assertEq(intake.acceptedDepositId(supplied.offerIndex), intake.depositIdFor(supplied));
            } else {
                assertEq(intake.acceptedDepositId(supplied.offerIndex), bytes32(0));
            }
        }
        for (uint256 i; i < 6; ++i) {
            assertEq(intake.depositedBitmapWord(i), bitmap[i]);
        }
        assertEq(intake.depositedOfferCount(), count);
        assertEq(handler.successfulCalls(), count);
        assertEq(intake.depositedGrossTotal(), gross);
        assertEq(intake.depositedPayoutTotal(), payout);
        assertEq(token.balanceOf(intake.OLD_TOKEN_RECIPIENT()), gross);
        assertEq(token.balanceOf(address(intake)), 0);
        assertLe(gross, intake.MAXIMUM_GROSS_AMOUNT());
        assertLe(payout, intake.MAXIMUM_PAYOUT_AMOUNT());
        assertTrue(intake.depositsOpen());
        assertEq(intake.activationAuthority(), address(0));
        assertEq(intake.activatedAtBlock(), 10_000);
    }

    function testHandlerExercisesSuccessAndAtomicFailureAcrossAllBitmapWords() public {
        for (uint256 i; i < 8; ++i) {
            handler.submit(i, 1, true);
            handler.submit(i, 0, true);
            handler.submit(i, 0, false);
        }
        invariantAccountingAndBitmapAreConserved();
        assertEq(handler.successfulCalls(), 8);
        assertEq(handler.rejectedCalls(), 16);
    }
}
