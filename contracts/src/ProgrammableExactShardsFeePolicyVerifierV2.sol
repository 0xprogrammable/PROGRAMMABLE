// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "./interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";
import {
    IProgrammableExactShardsFeePolicyVerifierV2
} from "./interfaces/IProgrammableExactShardsFeePolicyVerifierV2.sol";

/// @title ProgrammableExactShardsFeePolicyVerifierV2
/// @notice Stable reviewed economics template for every Shards launch; only the holder accumulator is JIT-bound.
/// @dev Platform route/factory runtimes are deliberately excluded and belong to LaunchPermit ReleaseBindingV1.
contract ProgrammableExactShardsFeePolicyVerifierV2 is IProgrammableExactShardsFeePolicyVerifierV2 {
    bytes32 public constant LEG_TYPEHASH = keccak256(
        "ProgrammableRevenueLegV1(bytes32 roleHash,uint16 feeBps,address recipient,bytes32 recipientModeHash)"
    );
    bytes32 public constant POLICY_TYPEHASH = keccak256(
        "ProgrammableRevenuePolicyV1(bytes32 profileKey,address feeAsset,bytes32 feeBasisHash,uint16 totalFeeBps,bytes32 legsHash)"
    );
    bytes32 public constant ECONOMIC_TEMPLATE_TYPEHASH = keccak256(
        "ProgrammableExactShardsEconomicTemplateV1(bytes32 policyTermsHash,bytes32 builderTermsHash,bytes32 programmableTermsHash,bytes32 holderTermsHash)"
    );
    bytes32 public constant SOURCE_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsReviewedBuildV1(bytes20 sourceCommit,bytes20 sourceTree,bytes32 sourceRevisionHash,bytes32 reviewedTechnicalBuildSha256)"
    );
    bytes32 public constant FEE_POLICY_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsFeePolicyBindingV2(bytes32 sourceBindingHash,bytes32 economicTemplateHash)"
    );
    bytes32 public constant EXPECTED_ECONOMIC_TEMPLATE_HASH =
        0x898f3bc526249e1917752c322011f2fae8729496fe410398b3745b9972f897fd;
    bytes32 public constant EXPECTED_FEE_POLICY_BINDING_HASH =
        0xfad5a3fbf661221cdfc8cb96f6df69b46b97775692bed2521c652db678e15e0d;

    bytes20 public constant REVIEWED_SOURCE_COMMIT = hex"91b38f3de64d96cac7e29f127c004f128fc1da59";
    bytes20 public constant REVIEWED_SOURCE_TREE = hex"92d6def8609e829487adea66c13901734e43c8c7";
    bytes32 public constant SOURCE_REVISION_HASH = 0x3352fe14662ce467e98f475cf91f10304ce4d69b6342fae4bf3dc968c494d6dc;
    bytes32 public constant REVIEWED_TECHNICAL_BUILD_SHA256 =
        0x2ad4194f0ff2d12245e8c933c02ceda6508bad03832a3f070dc426b35e9eb0ed;

    bytes32 public constant PROFILE_KEY = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    bytes32 public constant FEE_BASIS_HASH = 0xfb8110e8ea13fee890a868300dd1a9a5c467acb19a53f63beccc482757a36191;
    uint16 public constant TOTAL_FEE_BPS = 100;

    bytes32 public constant BUILDER_ROLE_HASH = 0x36a60a66fdf8fc39bbaab0d3ff46b52ffc8a9b6f3dc94b5fe9836816d72890af;
    bytes32 public constant BUILDER_RECIPIENT_MODE_HASH =
        0xc1ed7eaa8d37d922e99971bb6369533361b226b731cf9677e60e36b376519ea4;
    address public constant INITIAL_BUILDER_RECIPIENT = 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;
    uint16 public constant BUILDER_FEE_BPS = 10;

    bytes32 public constant PROGRAMMABLE_ROLE_HASH = 0x069cb8bbaf512d6f3d7fd962d64b67ce531a420f558aa3a2301e77be3640d875;
    bytes32 public constant PROGRAMMABLE_RECIPIENT_MODE_HASH =
        0x496f134b2bbc4d8ae230c1aa1a607788d75231c8ee823312e515b851a927d4f4;
    address public constant PROGRAMMABLE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint16 public constant PROGRAMMABLE_FEE_BPS = 10;

    bytes32 public constant HOLDER_ROLE_HASH = 0x84edd196638e45435db849686913b0ffb528525a1edc3aece78548ed6f2577f1;
    bytes32 public constant HOLDER_RECIPIENT_MODE_HASH =
        0x9aec909e12714c25df903902800a480772830ed15716e130e797f7447138ba55;
    bytes32 public constant HOLDER_RECIPIENT_SEMANTIC_HASH =
        keccak256("programmable.shards.holder-recipient.actual-launched-hook.v1");
    uint16 public constant HOLDER_FEE_BPS = 80;

    uint16 public constant BUILDER_SHARE_OF_FEE_BPS = 1000;
    uint16 public constant PROGRAMMABLE_SHARE_OF_FEE_BPS = 1000;
    uint16 public constant HOLDER_SHARE_OF_FEE_BPS = 8000;
    bytes4 public constant BUILDER_CLAIM_SELECTOR = bytes4(keccak256("claimBuilderFees()"));
    bytes4 public constant BUILDER_HANDOFF_SELECTOR = bytes4(keccak256("setBuilderFeeRecipient(address)"));
    bytes4 public constant PROGRAMMABLE_CLAIM_SELECTOR = bytes4(keccak256("claimLauncherFees()"));
    bytes4 public constant HOLDER_CLAIM_SELECTOR = bytes4(keccak256("claim(uint256[])"));

    uint8 private constant FIELD_PROFILE = 1;
    uint8 private constant FIELD_FEE_ASSET = 2;
    uint8 private constant FIELD_FEE_BASIS = 3;
    uint8 private constant FIELD_TOTAL_FEE = 4;
    uint8 private constant FIELD_BUILDER = 5;
    uint8 private constant FIELD_PROGRAMMABLE = 6;
    uint8 private constant FIELD_HOLDER = 7;
    uint8 private constant FIELD_LEG_SUM = 8;
    uint8 private constant FIELD_LEGS_HASH = 9;

    error InvalidShardsFeePolicy(uint8 field);

    function verify(
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 calldata policy,
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] calldata orderedLegs
    ) external pure returns (bytes32 policyHash) {
        if (policy.profileKey != PROFILE_KEY) _invalid(FIELD_PROFILE);
        if (policy.feeAsset != address(0)) _invalid(FIELD_FEE_ASSET);
        if (policy.feeBasisHash != FEE_BASIS_HASH) _invalid(FIELD_FEE_BASIS);
        if (policy.totalFeeBps != TOTAL_FEE_BPS) _invalid(FIELD_TOTAL_FEE);
        if (
            orderedLegs[0].roleHash != BUILDER_ROLE_HASH || orderedLegs[0].feeBps != BUILDER_FEE_BPS
                || orderedLegs[0].recipient != INITIAL_BUILDER_RECIPIENT
                || orderedLegs[0].recipientModeHash != BUILDER_RECIPIENT_MODE_HASH
        ) _invalid(FIELD_BUILDER);
        if (
            orderedLegs[1].roleHash != PROGRAMMABLE_ROLE_HASH || orderedLegs[1].feeBps != PROGRAMMABLE_FEE_BPS
                || orderedLegs[1].recipient != PROGRAMMABLE_RECIPIENT
                || orderedLegs[1].recipientModeHash != PROGRAMMABLE_RECIPIENT_MODE_HASH
        ) _invalid(FIELD_PROGRAMMABLE);
        if (
            orderedLegs[2].roleHash != HOLDER_ROLE_HASH || orderedLegs[2].feeBps != HOLDER_FEE_BPS
                || orderedLegs[2].recipient == address(0)
                || orderedLegs[2].recipientModeHash != HOLDER_RECIPIENT_MODE_HASH
        ) _invalid(FIELD_HOLDER);
        if (
            uint256(orderedLegs[0].feeBps) + uint256(orderedLegs[1].feeBps) + uint256(orderedLegs[2].feeBps)
                != TOTAL_FEE_BPS
        ) _invalid(FIELD_LEG_SUM);
        bytes32 legsHash =
            keccak256(abi.encode(hashLeg(orderedLegs[0]), hashLeg(orderedLegs[1]), hashLeg(orderedLegs[2])));
        if (policy.legsHash != legsHash) _invalid(FIELD_LEGS_HASH);
        return hashPolicy(policy);
    }

    function hashLeg(IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1 calldata leg)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(LEG_TYPEHASH, leg.roleHash, leg.feeBps, leg.recipient, leg.recipientModeHash));
    }

    function hashPolicy(IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 calldata policy)
        public
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                POLICY_TYPEHASH,
                policy.profileKey,
                policy.feeAsset,
                policy.feeBasisHash,
                policy.totalFeeBps,
                policy.legsHash
            )
        );
    }

    function economicTemplateHashV1() public pure returns (bytes32) {
        bytes32 policyTermsHash = keccak256(abi.encode(PROFILE_KEY, address(0), FEE_BASIS_HASH, TOTAL_FEE_BPS));
        bytes32 builderTermsHash = keccak256(
            abi.encode(
                BUILDER_ROLE_HASH,
                BUILDER_FEE_BPS,
                INITIAL_BUILDER_RECIPIENT,
                BUILDER_RECIPIENT_MODE_HASH,
                BUILDER_SHARE_OF_FEE_BPS,
                BUILDER_CLAIM_SELECTOR,
                BUILDER_HANDOFF_SELECTOR
            )
        );
        bytes32 programmableTermsHash = keccak256(
            abi.encode(
                PROGRAMMABLE_ROLE_HASH,
                PROGRAMMABLE_FEE_BPS,
                PROGRAMMABLE_RECIPIENT,
                PROGRAMMABLE_RECIPIENT_MODE_HASH,
                PROGRAMMABLE_SHARE_OF_FEE_BPS,
                PROGRAMMABLE_CLAIM_SELECTOR,
                bytes4(0)
            )
        );
        bytes32 holderTermsHash = keccak256(
            abi.encode(
                HOLDER_ROLE_HASH,
                HOLDER_FEE_BPS,
                HOLDER_RECIPIENT_MODE_HASH,
                HOLDER_SHARE_OF_FEE_BPS,
                HOLDER_CLAIM_SELECTOR,
                bytes4(0),
                HOLDER_RECIPIENT_SEMANTIC_HASH
            )
        );
        return keccak256(
            abi.encode(
                ECONOMIC_TEMPLATE_TYPEHASH, policyTermsHash, builderTermsHash, programmableTermsHash, holderTermsHash
            )
        );
    }

    function feePolicyBindingHashV2() external pure returns (bytes32) {
        bytes32 sourceBindingHash = keccak256(
            abi.encode(
                SOURCE_BINDING_TYPEHASH,
                REVIEWED_SOURCE_COMMIT,
                REVIEWED_SOURCE_TREE,
                SOURCE_REVISION_HASH,
                REVIEWED_TECHNICAL_BUILD_SHA256
            )
        );
        return keccak256(abi.encode(FEE_POLICY_BINDING_TYPEHASH, sourceBindingHash, economicTemplateHashV1()));
    }

    function _invalid(uint8 field) private pure {
        revert InvalidShardsFeePolicy(field);
    }
}
