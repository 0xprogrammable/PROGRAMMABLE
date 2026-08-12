// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Test } from "forge-std/Test.sol";

import { ProgrammableLaunchPermitVerifierV1 } from "../src/ProgrammableLaunchPermitVerifierV1.sol";
import { IProgrammableLaunchPermitAuthorityV1 } from "../src/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";

/// @dev Independent Solidity consumer of contracts/spec/launch-permit-v1-golden.json generated in JavaScript.
contract ProgrammableLaunchPermitV1GoldenTest is Test {
    ProgrammableLaunchPermitVerifierV1 private verifier;

    address private constant AUTHORITY = 0x1000000000000000000000000000000000000001;
    address private constant ROUTE = 0x2000000000000000000000000000000000000002;
    address private constant REGISTRY = 0x3000000000000000000000000000000000000003;
    address private constant APPLICANT = 0x4000000000000000000000000000000000000004;
    address private constant SIGNER = 0xd2431CA38735C2fd438e2cAa23F094191D89675b;

    function setUp() public {
        verifier = new ProgrammableLaunchPermitVerifierV1();
    }

    function test_javascriptGoldenMatchesAll26Permit17ReleaseAnd3KernelFields() public view {
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 memory kernel = _kernel();
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory release = _release();
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit = _permit();

        assertEq(verifier.EIP712_DOMAIN_TYPEHASH(), 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f);
        assertEq(verifier.LAUNCH_PERMIT_TYPEHASH(), 0x7ed0fe4321992c51bf55acad47b03f5ef2559a9cbb95312785865c298b56c93c);
        assertEq(
            verifier.GENERATION_BINDING_TYPEHASH(), 0x1d45c4a82ade927ae1d951f52be6454f8aa504521cdc97826dec3dbcba1e9313
        );
        assertEq(
            verifier.RELEASE_BINDING_TYPEHASH(), 0xe0599e608844d595fe40b3108c96266240f91cc9999276ea29935765dc361ab5
        );
        assertEq(
            verifier.KERNEL_EXECUTION_ENVELOPE_TYPEHASH(),
            0x746f3ea465bd2c6dd8670ed39508459773482db9b3963f8458892e15ea87d898
        );
        assertEq(
            verifier.domainSeparator(AUTHORITY, 1), 0x3ee8b15a490cdd276114542f24f56c3131606a11f5580bd91b8bb3c512f23b0a
        );
        assertEq(
            verifier.kernelEnvelopeHash(kernel), 0xe25351e23ecc6298558ca42627e294f23bee8cb700fd64473b0bac2d6f44c479
        );
        assertEq(
            verifier.releaseBindingHash(release), 0xca0157bbe86764b3bb800e91f72aaea14902ed0c419f56be170172493fd40c43
        );
        assertEq(
            verifier.generationBindingHash(permit), 0xf55b3e268ce2518cc04b2d215abb8547c27301ea3b8ccc495a9c2d4d44dd5520
        );
        assertEq(
            keccak256(abi.encode(verifier.LAUNCH_PERMIT_TYPEHASH(), permit)),
            0x3dfcda0c205149b5f72a698fb31516f00dc87cd3980d9bb82a964b7c987f198b
        );
        bytes32 digest = verifier.permitDigest(permit, AUTHORITY, 1);
        assertEq(digest, 0x059f98989db5fd1011941a25a8edfc361a1ffec30e28826c2e90a01d2459ea3e);

        bytes memory signature =
            hex"f81f9e210e22c772bf4e27a1e7872c7efe9d066545bef9d1f73cf578e06bfa782e3688cdddcc693f4686e62901eb3d50f571df664a60684a376d2cba226e543d1c";
        bytes32 s;
        assembly ("memory-safe") {
            s := mload(add(signature, 0x40))
        }
        assertLe(uint256(s), 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0);
        assertEq(ECDSA.recover(digest, signature), SIGNER);
    }

    function _kernel()
        private
        pure
        returns (IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 memory kernel)
    { }

    function _release() private pure returns (IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory release) {
        release.authorityGeneration = 1;
        release.releaseGeneration = 7;
        release.permitAuthority = AUTHORITY;
        release.permitAuthorityRuntimeCodeHash = 0x4e0f3ff73ffcd74ddf22b17f83aa94d6d2426c9c8ecb36693a62f93b409fa722;
        release.launchRegistry = REGISTRY;
        release.launchRegistryGeneration = 3;
        release.launchRegistryRuntimeCodeHash = 0x21609576889d67d8bb7ce817ecce925bc5f386fca4680d4325a6534f3a144225;
        release.chainProfileHash = 0xb75e8f1fed2e7e9d155642741dcd068758e41006ea30c79e368c2511b9518145;
        release.profile = ROUTE;
        release.profileId = 0x804e5d06c9060e495b238a3812c179f26293964f34995e4807ab34c767bb121b;
        release.profileRuntimeCodeHash = 0x8cce989158bc703a22ba5d46e11efe993aa3c5444141d37f0859a0aec39415e3;
        release.profileBindingHash = 0xdaa060cfcdf4f1610538e7da6c7d399c80535c14cadd22ba2b9e9e7d0235a576;
        release.route = ROUTE;
        release.routeId = 0xe82ee94c42c7b2173be0d7915d887f813837a51b40af7fe20c1d2accb6f10db8;
        release.routeRuntimeCodeHash = 0x8cce989158bc703a22ba5d46e11efe993aa3c5444141d37f0859a0aec39415e3;
        release.executionAuthorityHash = 0xb1fbb8f82a2a15020b407fb01ba97170c4fa8659cecce787e7c034b2c13a35b7;
        release.kernelEnvelopeMode = IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.NONE;
    }

    function _permit() private pure returns (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit) {
        permit.githubRepositoryId = 1_329_073_878;
        permit.approvalGeneration = 4;
        permit.permitGeneration = 9;
        permit.notBefore = 1_800_000_000;
        permit.deadline = 1_800_000_300;
        permit.signerEpoch = 2;
        permit.nonce = 0;
        permit.chainId = 1;
        permit.repositoryKey = 0x02ed38e86a7c41d5dea93cf5e3f829420837c4d351d9f4675929c6ce0041e835;
        permit.route = ROUTE;
        permit.routeId = 0xe82ee94c42c7b2173be0d7915d887f813837a51b40af7fe20c1d2accb6f10db8;
        permit.applicantWallet = APPLICANT;
        permit.launchId = 0xc1c7347dadfe424a2d8b16367e93a5171dc4efdeafd6b7876b1525d75416b1be;
        permit.approvalId = 0xe176695fdebc75012706edcbfadbfe8e5002ee42432f4b23e8cc5fcb215f0160;
        permit.technicalApprovalHash = 0x51117b520b79582e79c9152c7a7a9bf675fa64f5441c4d62e63a96e5fc768bc5;
        permit.descriptorHash = 0xc058b843afb4b28b02add7497e81d44250122ae6407856713d39bcef62f481a7;
        permit.presentationBindingHash = 0x56f7c0da5dd9e6eb4ded102f454d01619e651d407022f8415d5860cb05439631;
        permit.configurationHash = 0x80a6b0cba4a8f76e39f206236900067512118b9a47ce5d1348f25bb23f85a4f5;
        permit.walletOwnershipBindingHash = 0x915455bf85c49eb699e8813ad499270fe7ec3ffacc780ee82b22d011d1a5f2cc;
        permit.executionPlanHash = 0xcc6232eebb51fb89f637e1b04b994a5c0b2ae0598c1ff361f01c3fea731593c2;
        permit.executionCoreHash = 0x560ddf63bb1a896ec733467712498d8f98e37c70a87c7c63337fb5b084321db6;
        permit.executionCalldataKeccak256 = 0x47d10d9695e03b4a31a03a7122c17f7347ee1a938261d25a44744da480d9a881;
        permit.generationBindingHash = 0xf55b3e268ce2518cc04b2d215abb8547c27301ea3b8ccc495a9c2d4d44dd5520;
        permit.executionValue = 0;
        permit.releaseBindingHash = 0xca0157bbe86764b3bb800e91f72aaea14902ed0c419f56be170172493fd40c43;
        permit.kernelExecutionEnvelopeHash = 0xe25351e23ecc6298558ca42627e294f23bee8cb700fd64473b0bac2d6f44c479;
    }
}
