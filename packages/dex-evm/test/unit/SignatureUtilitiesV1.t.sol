// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { CanonicalEOASignatureV1 } from "../../src/profiles/CanonicalEOASignatureV1.sol";
import { ERC1271VerifierV1 } from "../../src/profiles/ERC1271VerifierV1.sol";
import { SignatureHarness } from "../helpers/SignatureHarness.sol";
import {
    GasGriefERC1271WalletMock,
    NonCanonicalTrailingERC1271WalletMock,
    OversizedERC1271WalletMock,
    RawFourByteERC1271WalletMock,
    RevertingERC1271WalletMock,
    ValidERC1271WalletMock,
    WrongMagicERC1271WalletMock
} from "../mocks/MockERC1271Wallets.sol";

contract SignatureUtilitiesV1Test is Test {
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant SECP256K1N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;

    SignatureHarness internal harness;
    bytes32 internal digest;

    function setUp() external {
        harness = new SignatureHarness();
        digest = keccak256("isolated signature utility test");
    }

    function test_recoversCanonicalLowSSignature() external view {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        assertEq(harness.recover(digest, signature), vm.addr(SIGNER_KEY));
    }

    /// Threat: actor=malleator; authority=signature encoding; pre=digest fixed; attempt=high-s; expect=revert; post=no
    /// signer.
    function test_rejectsMalleableHighS() external {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        bytes32 highS = bytes32(SECP256K1N - uint256(s));
        bytes memory signature = abi.encodePacked(r, highS, v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(abi.encodeWithSelector(CanonicalEOASignatureV1.InvalidSignatureS.selector, highS));
        harness.recover(digest, signature);
    }

    /// Threat: actor=malformed signer; authority=signature bytes; pre=digest fixed; attempt=64 bytes/v0; expect=revert;
    /// post=no signer.
    function test_rejectsNonCanonicalLengthAndV() external {
        vm.expectRevert(abi.encodeWithSelector(CanonicalEOASignatureV1.InvalidSignatureLength.selector, 64));
        harness.recover(digest, new bytes(64));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        v;
        vm.expectRevert(abi.encodeWithSelector(CanonicalEOASignatureV1.InvalidSignatureV.selector, uint8(0)));
        harness.recover(digest, abi.encodePacked(r, s, uint8(0)));
    }

    function test_eip712UtilityOnlyFramesProvidedHashes() external view {
        bytes32 domainSeparator = keccak256("candidate domain supplied externally");
        bytes32 structHash = keccak256("candidate struct supplied externally");
        assertEq(
            harness.hashTypedData(domainSeparator, structHash),
            keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash))
        );
    }

    function test_acceptsExactCanonicalERC1271Word() external {
        assertTrue(harness.verify1271(address(new ValidERC1271WalletMock()), digest, hex"1234"));
    }

    /// Threat: actor=1271 wallet; authority=return word; pre=input fixed; attempt=wrong/trailing bits; expect=revert;
    /// post=no auth.
    function test_rejectsWrongMagicAndNonzeroTrailingWord() external {
        WrongMagicERC1271WalletMock wrong = new WrongMagicERC1271WalletMock();
        vm.expectRevert();
        harness.verify1271(address(wrong), digest, hex"1234");

        NonCanonicalTrailingERC1271WalletMock trailing = new NonCanonicalTrailingERC1271WalletMock();
        bytes32 invalidWord = bytes32(bytes4(0x1626ba7e)) | bytes32(uint256(1));
        vm.expectRevert(abi.encodeWithSelector(ERC1271VerifierV1.InvalidWalletMagic.selector, invalidWord));
        harness.verify1271(address(trailing), digest, hex"1234");
    }

    /// Threat: actor=1271 wallet; authority=return length; pre=reserve; attempt=4/64 bytes; expect=revert; post=no
    /// auth.
    function test_rejectsRawAndOversizedReturnDataWithoutCopyingIt() external {
        RawFourByteERC1271WalletMock raw = new RawFourByteERC1271WalletMock();
        vm.expectRevert(abi.encodeWithSelector(ERC1271VerifierV1.InvalidWalletReturnLength.selector, uint256(4)));
        harness.verify1271(address(raw), digest, hex"1234");

        OversizedERC1271WalletMock oversized = new OversizedERC1271WalletMock();
        vm.expectRevert(abi.encodeWithSelector(ERC1271VerifierV1.InvalidWalletReturnLength.selector, uint256(64)));
        harness.verify1271(address(oversized), digest, hex"1234");
    }

    /// Threat: actor=wallet/submitter; authority=revert/address/input; pre=caps fixed; attempt=invalid cases;
    /// expect=revert; post=no auth.
    function test_rejectsRevertEOAAndOversizedSignature() external {
        RevertingERC1271WalletMock revertingWallet = new RevertingERC1271WalletMock();
        vm.expectRevert(abi.encodeWithSelector(ERC1271VerifierV1.WalletCallFailed.selector, address(revertingWallet)));
        harness.verify1271(address(revertingWallet), digest, hex"1234");

        address noCode = makeAddr("no code wallet");
        vm.expectRevert(abi.encodeWithSelector(ERC1271VerifierV1.WalletHasNoCode.selector, noCode));
        harness.verify1271(noCode, digest, hex"1234");

        ValidERC1271WalletMock valid = new ValidERC1271WalletMock();
        bytes memory oversizedSignature = new bytes(1025);
        vm.expectRevert(
            abi.encodeWithSelector(ERC1271VerifierV1.SignatureTooLarge.selector, uint256(1025), uint256(1024))
        );
        harness.verify1271(address(valid), digest, oversizedSignature);
    }

    /// Threat: actor=gas-grief wallet; authority=50k call budget; pre=reserve; attempt=consume budget; expect=revert;
    /// post=caller retains gas.
    function test_gasGriefIsBoundedAndFailsClosed() external {
        GasGriefERC1271WalletMock griefer = new GasGriefERC1271WalletMock();
        uint256 gasBefore = gasleft();
        vm.expectRevert(abi.encodeWithSelector(ERC1271VerifierV1.WalletCallFailed.selector, address(griefer)));
        harness.verify1271(address(griefer), digest, hex"1234");
        assertGt(gasBefore, gasleft(), "hostile call consumed no gas");
    }

    function test_verifierRejectsBeforeWalletCallWhenPostconditionReserveCannotBeGuaranteed() external {
        ValidERC1271WalletMock valid = new ValidERC1271WalletMock();
        bytes memory payload = abi.encodeCall(harness.verify1271, (address(valid), digest, hex"1234"));
        (bool success, bytes memory returnData) = address(harness).call{ gas: 140_000 }(payload);
        assertFalse(success, "under-reserved verifier call unexpectedly succeeded");
        assertGe(returnData.length, 4, "under-reserved verifier call returned no selector");
        // Safe: the length check above proves that the first four return bytes contain a complete error selector.
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(bytes4(returnData), ERC1271VerifierV1.InsufficientVerifierGas.selector);
    }
}
