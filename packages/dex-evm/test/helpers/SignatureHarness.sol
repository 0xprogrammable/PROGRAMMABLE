// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CanonicalEOASignatureV1 } from "../../src/profiles/CanonicalEOASignatureV1.sol";
import { EIP712HashingV1 } from "../../src/profiles/EIP712HashingV1.sol";
import { ERC1271VerifierV1 } from "../../src/profiles/ERC1271VerifierV1.sol";

contract SignatureHarness {
    function recover(bytes32 digest, bytes calldata signature) external pure returns (address) {
        return CanonicalEOASignatureV1.recover(digest, signature);
    }

    function hashTypedData(bytes32 domainSeparator, bytes32 structHash) external pure returns (bytes32) {
        return EIP712HashingV1.hashTypedData(domainSeparator, structHash);
    }

    function verify1271(address wallet, bytes32 digest, bytes calldata signature) external view returns (bool) {
        ERC1271VerifierV1.verify(wallet, digest, signature);
        return true;
    }
}
