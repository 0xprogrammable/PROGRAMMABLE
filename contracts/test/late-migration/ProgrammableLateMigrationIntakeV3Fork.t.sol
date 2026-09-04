// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { ProgrammableLateMigrationIntakeV3 } from "../../src/late-migration/ProgrammableLateMigrationIntakeV3.sol";

/// @dev Only the eligibility root is replaced for generated test keys. Chain, token runtime,
///      domain and every native permit/transfer path remain the production implementation.
contract NativeTokenIntakeV3ForkHarness is ProgrammableLateMigrationIntakeV3 {
    bytes32 internal immutable testRoot;

    constructor(bytes32 root) ProgrammableLateMigrationIntakeV3(msg.sender) {
        testRoot = root;
    }

    function eligibilityRoot() public view override returns (bytes32) {
        return testRoot;
    }
}

/// @dev Explicit opt-in read-only fork. Without the RPC setting Foundry reports these as skipped.
///      No transaction is signed for or sent to a public network.
contract ProgrammableLateMigrationIntakeV3ForkTest is Test {
    uint256 internal constant PINNED_FINALIZED_BLOCK = 25_906_557;
    uint256 internal constant PRIVATE_KEY = 0xA11CE;
    uint256 internal constant AMOUNT = 100_000 ether + 3;
    address internal constant TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    address internal constant RECIPIENT = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    NativeTokenIntakeV3ForkHarness internal intake;
    ProgrammableLateMigrationIntakeV3.Offer internal offer;

    function setUp() public {
        string memory rpc = vm.envOr("LATE_MIGRATION_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, PINNED_FINALIZED_BLOCK);
        assertEq(block.chainid, 1);
        offer = ProgrammableLateMigrationIntakeV3.Offer(73, vm.addr(PRIVATE_KEY), AMOUNT, 80_000 ether + 2);
        bytes32 root = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        bytes32(0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179),
                        offer.offerIndex,
                        offer.source,
                        offer.grossAmount,
                        offer.payoutAmount
                    )
                )
            )
        );
        intake = new NativeTokenIntakeV3ForkHarness(root);
        intake.assertPinnedOldToken();
        intake.activateDeposits();
        deal(TOKEN, offer.source, AMOUNT * 3);
    }

    function testForkNativePermitAndExactTransferFromEOA() public {
        _execute(false);
    }

    function testForkNativePermitAndExactTransferFromDelegatedEOA() public {
        _execute(true);
    }

    function testForkProductionActivationRejectsChainIdChange() public {
        ProgrammableLateMigrationIntakeV3 production = new ProgrammableLateMigrationIntakeV3(address(this));
        vm.chainId(4663);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableLateMigrationIntakeV3.WrongChain.selector, uint256(4663), uint256(1))
        );
        production.activateDeposits();
    }

    function _execute(bool delegated) private {
        if (delegated) vm.etch(offer.source, abi.encodePacked(hex"ef0100", address(0xBEEF)));
        uint256 nonce = IERC20Permit(TOKEN).nonces(offer.source);
        uint256 deadline = block.timestamp + 10 minutes;
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(PRIVATE_KEY, intake.permitDigest(offer.source, AMOUNT, nonce, deadline));
        uint256 recipientBefore = IERC20(TOKEN).balanceOf(RECIPIENT);
        intake.depositWithPermit(offer, new bytes32[](0), nonce, deadline, v, r, s);
        assertEq(IERC20(TOKEN).balanceOf(offer.source), AMOUNT * 2);
        assertEq(IERC20(TOKEN).balanceOf(RECIPIENT) - recipientBefore, AMOUNT);
        assertEq(IERC20(TOKEN).allowance(offer.source, address(intake)), 0);
        assertEq(IERC20Permit(TOKEN).nonces(offer.source), nonce + 1);
        assertEq(intake.depositedOfferCount(), 1);
        assertEq(intake.depositedPayoutTotal(), offer.payoutAmount);
        assertEq(intake.acceptedDepositId(offer.offerIndex), intake.depositIdFor(offer));
        assertEq(intake.depositedAtBlock(offer.offerIndex), PINNED_FINALIZED_BLOCK);
    }
}
