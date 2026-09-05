// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableLateMigrationIntakeV3 } from "../../src/late-migration/ProgrammableLateMigrationIntakeV3.sol";
import { PinnedPermitTokenMockV3 } from "./mocks/IntakeV3Mocks.sol";

contract ProgrammableLateMigrationIntakeV3Harness is ProgrammableLateMigrationIntakeV3 {
    bytes32 private immutable _testEligibilityRoot;

    constructor(address authority, bytes32 testEligibilityRoot) ProgrammableLateMigrationIntakeV3(authority) {
        _testEligibilityRoot = testEligibilityRoot;
    }

    function eligibilityRoot() public view override returns (bytes32) {
        return _testEligibilityRoot;
    }

    function _assertPinnedOldToken() internal view override { }
}

contract ProgrammableLateMigrationIntakeV3Test is Test {
    address internal constant OLD_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    address internal constant OLD_TOKEN_RECIPIENT = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant TARGET_TOKEN = 0xC60bA256B44334A0Cd2C7242E98B88f031abB006;

    uint256 internal constant USER_PRIVATE_KEY = 0xA11CE;
    uint256 internal constant OTHER_PRIVATE_KEY = 0xBEEF;
    address internal constant AUTHORITY = address(0xA1170);
    address internal constant RELAYER = address(0xB0B);
    address internal constant ATTACKER = address(0xBAD);

    uint256 internal constant OFFER_INDEX = 73;
    uint256 internal constant GROSS_AMOUNT = 100_000 ether + 3;
    uint256 internal constant PAYOUT_AMOUNT = 80_000 ether + 2;
    bytes32 internal constant TEST_ROOT = 0x90ada90a0a968e6a28b83726adb1dc82163046b1e7fe47c91de2db12d196dc70;

    ProgrammableLateMigrationIntakeV3Harness internal intake;
    PinnedPermitTokenMockV3 internal oldToken;
    ProgrammableLateMigrationIntakeV3.Offer internal offer;
    address internal user;

    event DepositsActivated(bytes32 indexed roundId, address indexed previousAuthority, uint256 activatedAtBlock);
    event MigrationDepositAccepted(
        bytes32 indexed roundId,
        bytes32 indexed depositId,
        address indexed source,
        uint256 offerIndex,
        uint256 grossAmount,
        uint256 manualPayoutAmount,
        address oldTokenRecipient,
        uint256 targetChainId,
        address targetToken,
        address sponsor,
        uint256 permitNonce
    );

    function setUp() public {
        vm.chainId(1);
        vm.roll(10_000);
        vm.warp(1_800_000_000);

        PinnedPermitTokenMockV3 implementation = new PinnedPermitTokenMockV3();
        vm.etch(OLD_TOKEN, address(implementation).code);
        oldToken = PinnedPermitTokenMockV3(OLD_TOKEN);

        user = vm.addr(USER_PRIVATE_KEY);
        offer = ProgrammableLateMigrationIntakeV3.Offer({
            offerIndex: OFFER_INDEX, source: user, grossAmount: GROSS_AMOUNT, payoutAmount: PAYOUT_AMOUNT
        });
        intake = new ProgrammableLateMigrationIntakeV3Harness(AUTHORITY, TEST_ROOT);
        assertEq(intake.leafHash(offer), TEST_ROOT, "frozen leaf encoding drifted");
        oldToken.mint(user, GROSS_AMOUNT * 3);
    }

    function testConstantsAndFrozenLeafEncodingAreExact() public view {
        assertEq(intake.SOURCE_CHAIN_ID(), 1);
        assertEq(intake.TARGET_CHAIN_ID(), 4663);
        assertEq(intake.OLD_TOKEN(), OLD_TOKEN);
        assertEq(intake.OLD_TOKEN_RECIPIENT(), OLD_TOKEN_RECIPIENT);
        assertEq(intake.TARGET_TOKEN(), TARGET_TOKEN);
        assertEq(intake.ELIGIBLE_OFFER_COUNT(), 1499);
        assertEq(intake.DEPOSIT_BITMAP_WORD_COUNT(), 6);
        assertEq(intake.MAXIMUM_GROSS_AMOUNT(), 176_529_129_261_873_518_239_425_341);
        assertEq(intake.MAXIMUM_PAYOUT_AMOUNT(), 141_223_303_409_498_814_591_539_678);
        assertEq(intake.expectedPayout(GROSS_AMOUNT), PAYOUT_AMOUNT);
        assertEq(intake.eligibilityRoot(), TEST_ROOT);
        assertEq(intake.ELIGIBILITY_ROOT(), 0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0);
        assertEq(intake.ROUND_ID(), 0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179);

        bytes32 expectedDepositId = keccak256(
            abi.encode(intake.ROUND_ID(), uint256(1), OLD_TOKEN, OFFER_INDEX, user, GROSS_AMOUNT, PAYOUT_AMOUNT)
        );
        assertEq(intake.depositIdFor(offer), expectedDepositId);
    }

    function testConstructorRejectsWrongChainZeroAuthorityAndWrongDomain() public {
        vm.chainId(4663);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableLateMigrationIntakeV3.WrongChain.selector, uint256(4663), uint256(1))
        );
        new ProgrammableLateMigrationIntakeV3Harness(AUTHORITY, TEST_ROOT);

        vm.chainId(1);
        vm.expectRevert(ProgrammableLateMigrationIntakeV3.ZeroActivationAuthority.selector);
        new ProgrammableLateMigrationIntakeV3Harness(address(0), TEST_ROOT);

        vm.mockCall(
            OLD_TOKEN,
            abi.encodeWithSelector(PinnedPermitTokenMockV3.DOMAIN_SEPARATOR.selector),
            abi.encode(bytes32(uint256(123)))
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.WrongOldTokenDomain.selector,
                bytes32(uint256(123)),
                intake.OLD_TOKEN_DOMAIN_SEPARATOR()
            )
        );
        new ProgrammableLateMigrationIntakeV3Harness(AUTHORITY, TEST_ROOT);
        vm.clearMockedCalls();
    }

    function testActivationIsAuthorizedOneWayAndDeletesAuthority() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.UnauthorizedActivator.selector, ATTACKER, AUTHORITY
            )
        );
        vm.prank(ATTACKER);
        intake.activateDeposits();

        vm.expectEmit(true, true, false, true, address(intake));
        emit DepositsActivated(intake.ROUND_ID(), AUTHORITY, block.number);
        vm.prank(AUTHORITY);
        intake.activateDeposits();

        assertTrue(intake.depositsOpen());
        assertEq(intake.activatedAtBlock(), block.number);
        assertEq(intake.activationAuthority(), address(0));

        vm.expectRevert(ProgrammableLateMigrationIntakeV3.DepositsAlreadyOpen.selector);
        vm.prank(AUTHORITY);
        intake.activateDeposits();
    }

    function testProductionActivationRejectsUnexpectedOldTokenRuntime() public {
        ProgrammableLateMigrationIntakeV3 production = new ProgrammableLateMigrationIntakeV3(AUTHORITY);
        bytes32 actual = OLD_TOKEN.codehash;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.UnexpectedRuntimeCodeHash.selector,
                OLD_TOKEN,
                actual,
                production.OLD_TOKEN_RUNTIME_CODEHASH()
            )
        );
        vm.prank(AUTHORITY);
        production.activateDeposits();
        assertFalse(production.depositsOpen());
        assertEq(production.activationAuthority(), AUTHORITY);
    }

    function testDepositIsClosedUntilActivation() public {
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        vm.expectRevert(ProgrammableLateMigrationIntakeV3.DepositsNotOpen.selector);
        vm.prank(RELAYER);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
    }

    function testHappyPathEmitsCompleteManualPayoutEvidenceAndAccountsExactly() public {
        _activate(intake);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        bytes32 depositId = intake.depositIdFor(offer);

        vm.expectEmit(true, true, true, true, address(intake));
        emit MigrationDepositAccepted(
            intake.ROUND_ID(),
            depositId,
            user,
            OFFER_INDEX,
            GROSS_AMOUNT,
            PAYOUT_AMOUNT,
            OLD_TOKEN_RECIPIENT,
            4663,
            TARGET_TOKEN,
            RELAYER,
            0
        );
        vm.prank(RELAYER);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);

        assertEq(oldToken.balanceOf(user), GROSS_AMOUNT * 2);
        assertEq(oldToken.balanceOf(OLD_TOKEN_RECIPIENT), GROSS_AMOUNT);
        assertEq(oldToken.balanceOf(address(intake)), 0);
        assertEq(oldToken.allowance(user, address(intake)), 0);
        assertEq(oldToken.nonces(user), 1);
        assertTrue(intake.isOfferDeposited(OFFER_INDEX));
        assertTrue(intake.consumedSource(user));
        assertEq(intake.acceptedDepositId(OFFER_INDEX), depositId);
        assertEq(intake.depositedAtBlock(OFFER_INDEX), block.number);
        assertEq(intake.depositedOfferCount(), 1);
        assertEq(intake.depositedGrossTotal(), GROSS_AMOUNT);
        assertEq(intake.depositedPayoutTotal(), PAYOUT_AMOUNT);
        assertEq(intake.depositedBitmapWord(0), uint256(1) << OFFER_INDEX);
    }

    function testAnySponsorCanSubmitButCannotChangeRecipientOrAmount() public {
        _activate(intake);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        vm.prank(ATTACKER);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);

        assertEq(oldToken.balanceOf(ATTACKER), 0);
        assertEq(oldToken.balanceOf(address(intake)), 0);
        assertEq(oldToken.balanceOf(OLD_TOKEN_RECIPIENT), GROSS_AMOUNT);
    }

    function testFrontRunPermitIsToleratedOnlyWithExactAllowance() public {
        _activate(intake);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);

        vm.prank(ATTACKER);
        oldToken.permit(user, address(intake), GROSS_AMOUNT, deadline, v, r, s);
        assertEq(oldToken.nonces(user), 1);
        assertEq(oldToken.allowance(user, address(intake)), GROSS_AMOUNT);

        vm.prank(RELAYER);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        assertEq(oldToken.balanceOf(OLD_TOKEN_RECIPIENT), GROSS_AMOUNT);
    }

    function testPermitFailureCannotUseAnUnconsumedExistingApproval() public {
        _activate(intake);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        oldToken.setForcePermitRevert(true);
        vm.prank(user);
        oldToken.approve(address(intake), GROSS_AMOUNT);

        vm.expectRevert(PinnedPermitTokenMockV3.ForcedPermitFailure.selector);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        _assertNoDepositState();
        assertEq(oldToken.nonces(user), 0);
        assertEq(oldToken.allowance(user, address(intake)), GROSS_AMOUNT);
    }

    function testOverAllowanceAfterFrontRunPermitIsRejected() public {
        _activate(intake);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        oldToken.permit(user, address(intake), GROSS_AMOUNT, deadline, v, r, s);
        vm.prank(user);
        oldToken.approve(address(intake), GROSS_AMOUNT + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.PermitAllowanceMismatch.selector, GROSS_AMOUNT + 1, GROSS_AMOUNT
            )
        );
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        _assertNoDepositState();
        assertEq(oldToken.nonces(user), 1);
    }

    function testFutureAndAdvancedPermitNoncesAreRejectedAtomically() public {
        _activate(intake);
        (uint8 futureV, bytes32 futureR, bytes32 futureS, uint256 deadline) =
            _signedPermit(intake, offer, USER_PRIVATE_KEY, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.PermitNonceInFuture.selector, uint256(1), uint256(0)
            )
        );
        vm.prank(RELAYER);
        intake.depositWithPermit(offer, new bytes32[](0), 1, deadline, futureV, futureR, futureS);

        (uint8 v, bytes32 r, bytes32 s,) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        vm.prank(ATTACKER);
        oldToken.permit(user, address(intake), GROSS_AMOUNT, deadline, v, r, s);
        _useUnrelatedPermit(1, deadline);
        assertEq(oldToken.nonces(user), 2);
        assertEq(oldToken.allowance(user, address(intake)), GROSS_AMOUNT);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.PermitNonceAdvancedTooFar.selector, uint256(0), uint256(2)
            )
        );
        vm.prank(RELAYER);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        assertFalse(intake.isOfferDeposited(OFFER_INDEX));
        assertEq(oldToken.balanceOf(OLD_TOKEN_RECIPIENT), 0);
    }

    function testRevokedAllowanceRejectsPreSubmittedPermit() public {
        _activate(intake);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        oldToken.permit(user, address(intake), GROSS_AMOUNT, deadline, v, r, s);
        vm.prank(user);
        oldToken.approve(address(intake), 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.PermitAllowanceMismatch.selector, uint256(0), GROSS_AMOUNT
            )
        );
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        _assertNoDepositState();
        assertEq(oldToken.nonces(user), 1);
    }

    function testPermitDeadlineAndSignerValidationAreStrict() public {
        _activate(intake);
        uint256 expired = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_PRIVATE_KEY, intake.permitDigest(user, GROSS_AMOUNT, 0, expired));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.PermitDeadlineExpired.selector, expired, block.timestamp
            )
        );
        intake.depositWithPermit(offer, new bytes32[](0), 0, expired, v, r, s);

        uint256 tooFar = block.timestamp + intake.MAX_PERMIT_DEADLINE_LEAD() + 1;
        (v, r, s) = vm.sign(USER_PRIVATE_KEY, intake.permitDigest(user, GROSS_AMOUNT, 0, tooFar));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.PermitDeadlineTooFar.selector,
                tooFar,
                block.timestamp + intake.MAX_PERMIT_DEADLINE_LEAD()
            )
        );
        intake.depositWithPermit(offer, new bytes32[](0), 0, tooFar, v, r, s);

        uint256 validDeadline = block.timestamp + 10 minutes;
        (v, r, s) = vm.sign(OTHER_PRIVATE_KEY, intake.permitDigest(user, GROSS_AMOUNT, 0, validDeadline));
        vm.expectPartialRevert(ProgrammableLateMigrationIntakeV3.PermitSignerMismatch.selector);
        intake.depositWithPermit(offer, new bytes32[](0), 0, validDeadline, v, r, s);
    }

    function testOfferValidationRejectsEveryMutableField() public {
        _activate(intake);
        ProgrammableLateMigrationIntakeV3.Offer memory invalid = offer;
        invalid.payoutAmount += 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.IncorrectPayout.selector, PAYOUT_AMOUNT + 1, PAYOUT_AMOUNT
            )
        );
        intake.depositWithPermit(invalid, new bytes32[](0), 0, block.timestamp, 27, bytes32(0), bytes32(0));

        invalid = offer;
        invalid.offerIndex = 1499;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.OfferIndexOutOfBounds.selector, uint256(1499), uint256(1499)
            )
        );
        intake.depositWithPermit(invalid, new bytes32[](0), 0, block.timestamp, 27, bytes32(0), bytes32(0));

        invalid = offer;
        invalid.source = address(0);
        vm.expectRevert(ProgrammableLateMigrationIntakeV3.ZeroSource.selector);
        intake.depositWithPermit(invalid, new bytes32[](0), 0, block.timestamp, 27, bytes32(0), bytes32(0));

        invalid = offer;
        invalid.grossAmount = 0;
        invalid.payoutAmount = 0;
        vm.expectRevert(ProgrammableLateMigrationIntakeV3.InvalidAmount.selector);
        intake.depositWithPermit(invalid, new bytes32[](0), 0, block.timestamp, 27, bytes32(0), bytes32(0));

        invalid = offer;
        invalid.grossAmount += 1;
        invalid.payoutAmount = intake.expectedPayout(invalid.grossAmount);
        vm.expectPartialRevert(ProgrammableLateMigrationIntakeV3.InvalidEligibilityProof.selector);
        intake.depositWithPermit(invalid, new bytes32[](0), 0, block.timestamp, 27, bytes32(0), bytes32(0));
    }

    function testOfferAndSourceCanEachBeConsumedOnlyOnce() public {
        _activate(intake);
        _deposit(intake, offer, new bytes32[](0), USER_PRIVATE_KEY, 0, RELAYER);

        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 1);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableLateMigrationIntakeV3.OfferAlreadyDeposited.selector, OFFER_INDEX)
        );
        intake.depositWithPermit(offer, new bytes32[](0), 1, deadline, v, r, s);

        ProgrammableLateMigrationIntakeV3.Offer memory second = ProgrammableLateMigrationIntakeV3.Offer({
            offerIndex: 74, source: user, grossAmount: 50_000 ether + 7, payoutAmount: 40_000 ether + 5
        });
        bytes32 secondLeaf = intake.leafHash(second);
        bytes32 pairRoot = _hashPair(TEST_ROOT, secondLeaf);
        ProgrammableLateMigrationIntakeV3Harness paired =
            new ProgrammableLateMigrationIntakeV3Harness(AUTHORITY, pairRoot);
        _activate(paired);

        oldToken.mint(user, GROSS_AMOUNT);
        bytes32[] memory firstProof = new bytes32[](1);
        firstProof[0] = secondLeaf;
        _deposit(paired, offer, firstProof, USER_PRIVATE_KEY, 1, RELAYER);

        bytes32[] memory secondProof = new bytes32[](1);
        secondProof[0] = TEST_ROOT;
        vm.expectRevert(abi.encodeWithSelector(ProgrammableLateMigrationIntakeV3.SourceAlreadyDeposited.selector, user));
        paired.depositWithPermit(second, secondProof, 2, block.timestamp + 10 minutes, 27, bytes32(0), bytes32(0));
    }

    function testNonStandardTransferBehaviorRevertsAllDepositState() public {
        _activate(intake);
        oldToken.setFeeOnTransfer(true);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        vm.expectPartialRevert(ProgrammableLateMigrationIntakeV3.RecipientBalanceDeltaMismatch.selector);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        _assertNoDepositState();
        assertEq(oldToken.nonces(user), 0);

        oldToken.setFeeOnTransfer(false);
        oldToken.setForceTransferFromFalse(true);
        vm.expectRevert();
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        _assertNoDepositState();
        assertEq(oldToken.nonces(user), 0);
    }

    function testAggregateCapsFailClosedBeforeTokenMovement() public {
        uint256 excessiveGross = intake.MAXIMUM_GROSS_AMOUNT() + 1;
        ProgrammableLateMigrationIntakeV3.Offer memory excessive = ProgrammableLateMigrationIntakeV3.Offer({
            offerIndex: 0,
            source: user,
            grossAmount: excessiveGross,
            payoutAmount: intake.expectedPayout(excessiveGross)
        });
        ProgrammableLateMigrationIntakeV3Harness grossHarness =
            new ProgrammableLateMigrationIntakeV3Harness(AUTHORITY, intake.leafHash(excessive));
        _activate(grossHarness);
        oldToken.mint(user, excessiveGross);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(grossHarness, excessive, USER_PRIVATE_KEY, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.AggregateGrossExceeded.selector,
                excessiveGross,
                intake.MAXIMUM_GROSS_AMOUNT()
            )
        );
        grossHarness.depositWithPermit(excessive, new bytes32[](0), 0, deadline, v, r, s);

        uint256 maxGross = intake.MAXIMUM_GROSS_AMOUNT();
        ProgrammableLateMigrationIntakeV3.Offer memory payoutExcessive = ProgrammableLateMigrationIntakeV3.Offer({
            offerIndex: 0, source: user, grossAmount: maxGross, payoutAmount: intake.expectedPayout(maxGross)
        });
        assertGt(payoutExcessive.payoutAmount, intake.MAXIMUM_PAYOUT_AMOUNT());
        ProgrammableLateMigrationIntakeV3Harness payoutHarness =
            new ProgrammableLateMigrationIntakeV3Harness(AUTHORITY, intake.leafHash(payoutExcessive));
        _activate(payoutHarness);
        (v, r, s, deadline) = _signedPermit(payoutHarness, payoutExcessive, USER_PRIVATE_KEY, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.AggregatePayoutExceeded.selector,
                payoutExcessive.payoutAmount,
                intake.MAXIMUM_PAYOUT_AMOUNT()
            )
        );
        payoutHarness.depositWithPermit(payoutExcessive, new bytes32[](0), 0, deadline, v, r, s);

        assertEq(oldToken.balanceOf(OLD_TOKEN_RECIPIENT), 0);
        assertEq(oldToken.nonces(user), 0);
    }

    function testBitmapAndAcceptedDepositViewsAreBounded() public {
        assertFalse(intake.isOfferDeposited(1499));
        assertFalse(intake.isOfferDeposited(type(uint256).max));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.OfferIndexOutOfBounds.selector, uint256(1536), uint256(1499)
            )
        );
        intake.depositedBitmapWord(6);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.OfferIndexOutOfBounds.selector, uint256(1499), uint256(1499)
            )
        );
        intake.acceptedDepositId(1499);
    }

    function testTokenCannotPretendToConsumePermitWithoutAdvancingNonce() public {
        _activate(intake);
        oldToken.setSkipPermitNonce(true);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableLateMigrationIntakeV3.PermitNonceNotConsumed.selector, uint256(1), uint256(0)
            )
        );
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        _assertNoDepositState();
        assertEq(oldToken.allowance(user, address(intake)), 0);
    }

    function testExtraSourceDebitFailsAtomically() public {
        _activate(intake);
        oldToken.setExtraSourceDebit(true);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        vm.expectPartialRevert(ProgrammableLateMigrationIntakeV3.SourceBalanceDeltaMismatch.selector);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        _assertNoDepositState();
        assertEq(oldToken.balanceOf(user), GROSS_AMOUNT * 3);
        assertEq(oldToken.nonces(user), 0);
    }

    function testReentrantTokenCannotCreateAnExtraDeposit() public {
        _activate(intake);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(intake, offer, USER_PRIVATE_KEY, 0);
        oldToken.setCallback(
            address(intake), abi.encodeCall(intake.depositWithPermit, (offer, new bytes32[](0), 0, deadline, v, r, s))
        );
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        assertFalse(oldToken.callbackSucceeded());
        assertEq(intake.depositedOfferCount(), 1);
        assertEq(oldToken.balanceOf(OLD_TOKEN_RECIPIENT), GROSS_AMOUNT);
    }

    function testDelegatedEOAMustUseTheUnderlyingOwnerSignature() public {
        // EIP-7702 delegation marker; this does not assert a wallet provider's signing UX.
        vm.etch(user, abi.encodePacked(hex"ef0100", ATTACKER));
        _activate(intake);
        (uint8 wrongV, bytes32 wrongR, bytes32 wrongS, uint256 deadline) =
            _signedPermit(intake, offer, OTHER_PRIVATE_KEY, 0);
        vm.expectPartialRevert(ProgrammableLateMigrationIntakeV3.PermitSignerMismatch.selector);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, wrongV, wrongR, wrongS);
        _assertNoDepositState();
        _deposit(intake, offer, new bytes32[](0), USER_PRIVATE_KEY, 0, RELAYER);
        assertTrue(intake.consumedSource(user));
    }

    function testChangingTheSpenderInvalidatesThePermit() public {
        _activate(intake);
        ProgrammableLateMigrationIntakeV3Harness other =
            new ProgrammableLateMigrationIntakeV3Harness(AUTHORITY, TEST_ROOT);
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(other, offer, USER_PRIVATE_KEY, 0);
        vm.expectPartialRevert(ProgrammableLateMigrationIntakeV3.PermitSignerMismatch.selector);
        intake.depositWithPermit(offer, new bytes32[](0), 0, deadline, v, r, s);
        _assertNoDepositState();
    }

    function testPermitAtExactDeadlineRemainsValid() public {
        _activate(intake);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(USER_PRIVATE_KEY, intake.permitDigest(user, GROSS_AMOUNT, 0, block.timestamp));
        intake.depositWithPermit(offer, new bytes32[](0), 0, block.timestamp, v, r, s);
        assertTrue(intake.consumedSource(user));
    }

    function testUnrelatedDirectTransfersDoNotCreatePayoutEvidence() public {
        vm.prank(user);
        oldToken.transfer(OLD_TOKEN_RECIPIENT, 7);
        assertEq(intake.depositedOfferCount(), 0);
        assertEq(intake.depositedPayoutTotal(), 0);
        assertEq(intake.acceptedDepositId(OFFER_INDEX), bytes32(0));
        assertFalse(intake.consumedSource(user));
    }

    function testFuzzExpectedPayoutIsFloorBounded(uint256 grossAmount) public view {
        uint256 payout = intake.expectedPayout(grossAmount);
        assertLe(payout, grossAmount);
        // Independent overflow-safe quotient/remainder oracle covers all uint256 values.
        assertEq(payout, (grossAmount / 5) * 4 + (grossAmount % 5) * 4 / 5);
    }

    function _activate(ProgrammableLateMigrationIntakeV3 target) private {
        vm.prank(AUTHORITY);
        target.activateDeposits();
    }

    function _deposit(
        ProgrammableLateMigrationIntakeV3 target,
        ProgrammableLateMigrationIntakeV3.Offer memory suppliedOffer,
        bytes32[] memory proof,
        uint256 privateKey,
        uint256 nonce,
        address sponsor
    ) private {
        (uint8 v, bytes32 r, bytes32 s, uint256 deadline) = _signedPermit(target, suppliedOffer, privateKey, nonce);
        vm.prank(sponsor);
        target.depositWithPermit(suppliedOffer, proof, nonce, deadline, v, r, s);
    }

    function _signedPermit(
        ProgrammableLateMigrationIntakeV3 target,
        ProgrammableLateMigrationIntakeV3.Offer memory suppliedOffer,
        uint256 privateKey,
        uint256 nonce
    ) private view returns (uint8 v, bytes32 r, bytes32 s, uint256 deadline) {
        deadline = block.timestamp + 10 minutes;
        (v, r, s) = vm.sign(
            privateKey, target.permitDigest(suppliedOffer.source, suppliedOffer.grossAmount, nonce, deadline)
        );
    }

    function _useUnrelatedPermit(uint256 nonce, uint256 deadline) private {
        bytes32 typeHash =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(typeHash, user, ATTACKER, uint256(1), nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", intake.OLD_TOKEN_DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_PRIVATE_KEY, digest);
        vm.prank(ATTACKER);
        oldToken.permit(user, ATTACKER, 1, deadline, v, r, s);
    }

    function _assertNoDepositState() private view {
        assertFalse(intake.isOfferDeposited(OFFER_INDEX));
        assertFalse(intake.consumedSource(user));
        assertEq(intake.acceptedDepositId(OFFER_INDEX), bytes32(0));
        assertEq(intake.depositedAtBlock(OFFER_INDEX), 0);
        assertEq(intake.depositedOfferCount(), 0);
        assertEq(intake.depositedGrossTotal(), 0);
        assertEq(intake.depositedPayoutTotal(), 0);
        assertEq(oldToken.balanceOf(OLD_TOKEN_RECIPIENT), 0);
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return uint256(a) < uint256(b) ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
