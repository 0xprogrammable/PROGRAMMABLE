// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";

import { ClassicLaunchPolicyV1 } from "../src/ClassicLaunchPolicyV1.sol";

contract ClassicLaunchPolicyV1Test is Test {
    ClassicLaunchPolicyV1 internal policy;

    function setUp() public {
        policy = new ClassicLaunchPolicyV1();
    }

    function test_acceptsEveryPublishedBoundaryAndFiveUnequalAllocations() public view {
        address[] memory beneficiaries = new address[](5);
        uint16[] memory sharesBps = new uint16[](5);
        for (uint256 index; index < 5; index++) {
            beneficiaries[index] = address(uint160(index + 1));
        }
        sharesBps[0] = 5000;
        sharesBps[1] = 2000;
        sharesBps[2] = 1500;
        sharesBps[3] = 1000;
        sharesBps[4] = 500;

        policy.validate(
            _string(policy.MAX_TOKEN_NAME_BYTES(), bytes1("N")),
            _string(policy.MAX_TOKEN_SYMBOL_BYTES(), bytes1("S")),
            UERC20Metadata({
                description: _string(policy.MAX_TOKEN_DESCRIPTION_BYTES(), bytes1("D")),
                website: _string(policy.MAX_METADATA_URL_BYTES(), bytes1("W")),
                image: _string(policy.MAX_METADATA_URL_BYTES(), bytes1("I")),
                extraData: bytes(_string(policy.MAX_SOCIAL_EXTRA_DATA_BYTES(), bytes1("X")))
            }),
            beneficiaries,
            sharesBps
        );
    }

    function test_rejectsEmptyNameAndSymbol() public {
        (address[] memory beneficiaries, uint16[] memory sharesBps) = _singleAllocation();
        UERC20Metadata memory metadata = _metadata();

        vm.expectRevert(ClassicLaunchPolicyV1.EmptyName.selector);
        policy.validate("", "TOKEN", metadata, beneficiaries, sharesBps);

        vm.expectRevert(ClassicLaunchPolicyV1.EmptySymbol.selector);
        policy.validate("Token", "", metadata, beneficiaries, sharesBps);
    }

    function test_rejectsEachMetadataFieldAboveItsPublishedLimit() public {
        (address[] memory beneficiaries, uint16[] memory sharesBps) = _singleAllocation();
        UERC20Metadata memory metadata = _metadata();
        uint256 maxNameBytes = policy.MAX_TOKEN_NAME_BYTES();
        uint256 maxSymbolBytes = policy.MAX_TOKEN_SYMBOL_BYTES();
        uint256 maxDescriptionBytes = policy.MAX_TOKEN_DESCRIPTION_BYTES();
        uint256 maxUrlBytes = policy.MAX_METADATA_URL_BYTES();
        uint256 maxExtraDataBytes = policy.MAX_SOCIAL_EXTRA_DATA_BYTES();

        vm.expectRevert(
            abi.encodeWithSelector(ClassicLaunchPolicyV1.TokenNameTooLong.selector, maxNameBytes + 1, maxNameBytes)
        );
        policy.validate(_string(maxNameBytes + 1, bytes1("N")), "TOKEN", metadata, beneficiaries, sharesBps);

        vm.expectRevert(
            abi.encodeWithSelector(
                ClassicLaunchPolicyV1.TokenSymbolTooLong.selector, maxSymbolBytes + 1, maxSymbolBytes
            )
        );
        policy.validate("Token", _string(maxSymbolBytes + 1, bytes1("S")), metadata, beneficiaries, sharesBps);

        metadata.description = _string(maxDescriptionBytes + 1, bytes1("D"));
        vm.expectRevert(
            abi.encodeWithSelector(
                ClassicLaunchPolicyV1.TokenDescriptionTooLong.selector, maxDescriptionBytes + 1, maxDescriptionBytes
            )
        );
        policy.validate("Token", "TOKEN", metadata, beneficiaries, sharesBps);

        metadata = _metadata();
        metadata.website = _string(maxUrlBytes + 1, bytes1("W"));
        vm.expectRevert(
            abi.encodeWithSelector(ClassicLaunchPolicyV1.MetadataWebsiteTooLong.selector, maxUrlBytes + 1, maxUrlBytes)
        );
        policy.validate("Token", "TOKEN", metadata, beneficiaries, sharesBps);

        metadata = _metadata();
        metadata.image = _string(maxUrlBytes + 1, bytes1("I"));
        vm.expectRevert(
            abi.encodeWithSelector(ClassicLaunchPolicyV1.MetadataImageTooLong.selector, maxUrlBytes + 1, maxUrlBytes)
        );
        policy.validate("Token", "TOKEN", metadata, beneficiaries, sharesBps);

        metadata = _metadata();
        metadata.extraData = bytes(_string(maxExtraDataBytes + 1, bytes1("X")));
        vm.expectRevert(
            abi.encodeWithSelector(
                ClassicLaunchPolicyV1.MetadataExtraDataTooLong.selector, maxExtraDataBytes + 1, maxExtraDataBytes
            )
        );
        policy.validate("Token", "TOKEN", metadata, beneficiaries, sharesBps);
    }

    function test_rejectsInvalidRewardCountsWalletsSharesAndTotals() public {
        UERC20Metadata memory metadata = _metadata();
        address[] memory beneficiaries = new address[](0);
        uint16[] memory sharesBps = new uint16[](0);
        vm.expectRevert(abi.encodeWithSelector(ClassicLaunchPolicyV1.InvalidBeneficiaryCount.selector, 0));
        policy.validate("Token", "TOKEN", metadata, beneficiaries, sharesBps);

        beneficiaries = new address[](2);
        beneficiaries[0] = address(1);
        beneficiaries[1] = address(1);
        sharesBps = new uint16[](2);
        sharesBps[0] = 5000;
        sharesBps[1] = 5000;
        vm.expectRevert(abi.encodeWithSelector(ClassicLaunchPolicyV1.DuplicateRewardBeneficiary.selector, address(1)));
        policy.validate("Token", "TOKEN", metadata, beneficiaries, sharesBps);

        beneficiaries[1] = address(2);
        beneficiaries[0] = address(0);
        vm.expectRevert(abi.encodeWithSelector(ClassicLaunchPolicyV1.InvalidRewardBeneficiary.selector, address(0)));
        policy.validate("Token", "TOKEN", metadata, beneficiaries, sharesBps);

        beneficiaries[0] = address(1);
        sharesBps[0] = 0;
        sharesBps[1] = 10_000;
        vm.expectRevert(
            abi.encodeWithSelector(ClassicLaunchPolicyV1.InvalidRewardShare.selector, address(1), uint16(0))
        );
        policy.validate("Token", "TOKEN", metadata, beneficiaries, sharesBps);

        sharesBps[0] = 4000;
        sharesBps[1] = 5000;
        vm.expectRevert(abi.encodeWithSelector(ClassicLaunchPolicyV1.InvalidRewardShareTotal.selector, 9000));
        policy.validate("Token", "TOKEN", metadata, beneficiaries, sharesBps);
    }

    function _metadata() private pure returns (UERC20Metadata memory) {
        return UERC20Metadata({
            description: "Classic token",
            website: "https://programmable.family",
            image: "ipfs://classic",
            extraData: bytes("")
        });
    }

    function _singleAllocation() private pure returns (address[] memory beneficiaries, uint16[] memory sharesBps) {
        beneficiaries = new address[](1);
        beneficiaries[0] = address(1);
        sharesBps = new uint16[](1);
        sharesBps[0] = 10_000;
    }

    function _string(uint256 length, bytes1 character) private pure returns (string memory value) {
        bytes memory output = new bytes(length);
        for (uint256 index; index < length; index++) {
            output[index] = character;
        }
        return string(output);
    }
}
