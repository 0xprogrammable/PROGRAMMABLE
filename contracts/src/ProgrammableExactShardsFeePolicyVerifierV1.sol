// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "./interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";

/// @notice Exact hashing and validation shared by the public Shards fee-policy verifier.
library ProgrammableExactShardsFeePolicyVerifierLibV1 {
    bytes32 internal constant LEG_TYPEHASH = keccak256(
        "ProgrammableRevenueLegV1(bytes32 roleHash,uint16 feeBps,address recipient,bytes32 recipientModeHash)"
    );
    bytes32 internal constant POLICY_TYPEHASH = keccak256(
        "ProgrammableRevenuePolicyV1(bytes32 profileKey,address feeAsset,bytes32 feeBasisHash,uint16 totalFeeBps,bytes32 legsHash)"
    );

    bytes32 internal constant PROFILE_KEY = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    bytes32 internal constant FEE_BASIS_HASH = 0xfb8110e8ea13fee890a868300dd1a9a5c467acb19a53f63beccc482757a36191;
    uint16 internal constant TOTAL_FEE_BPS = 100;

    bytes32 internal constant BUILDER_ROLE_HASH = 0x36a60a66fdf8fc39bbaab0d3ff46b52ffc8a9b6f3dc94b5fe9836816d72890af;
    bytes32 internal constant BUILDER_RECIPIENT_MODE_HASH =
        0xc1ed7eaa8d37d922e99971bb6369533361b226b731cf9677e60e36b376519ea4;
    address internal constant INITIAL_BUILDER_RECIPIENT = 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;
    uint16 internal constant BUILDER_FEE_BPS = 10;

    bytes32 internal constant PROGRAMMABLE_ROLE_HASH =
        0x069cb8bbaf512d6f3d7fd962d64b67ce531a420f558aa3a2301e77be3640d875;
    bytes32 internal constant PROGRAMMABLE_RECIPIENT_MODE_HASH =
        0x496f134b2bbc4d8ae230c1aa1a607788d75231c8ee823312e515b851a927d4f4;
    address internal constant PROGRAMMABLE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint16 internal constant PROGRAMMABLE_FEE_BPS = 10;

    bytes32 internal constant HOLDER_ROLE_HASH = 0x84edd196638e45435db849686913b0ffb528525a1edc3aece78548ed6f2577f1;
    bytes32 internal constant HOLDER_RECIPIENT_MODE_HASH =
        0x9aec909e12714c25df903902800a480772830ed15716e130e797f7447138ba55;
    address internal constant HOLDER_ACCUMULATOR = 0xbA318baA8649962fD77CC7082d098f2C09Fd60cC;
    uint16 internal constant HOLDER_FEE_BPS = 80;

    bytes32 internal constant BUILDER_LEG_HASH = 0x10c851ca78aa2bf257e924b5b4b1a471b8f091e5d971f1a2422165a60bd325ac;
    bytes32 internal constant PROGRAMMABLE_LEG_HASH =
        0xccc9d7a84cef40c38d165ba1ce0f1817f77172bc97b49155ac6a14fcc5e6cff5;
    bytes32 internal constant HOLDER_LEG_HASH = 0x30cf730abcc37ad7db1d6e91abad8c1564fc624c777c456da987f0e006b9ff9e;
    bytes32 internal constant LEGS_HASH = 0x14e66b725eaebf6f894323565651567cc05a71bbb263db373d1f9f59ea171899;
    bytes32 internal constant REVENUE_POLICY_HASH = 0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2;

    uint8 private constant FIELD_PROFILE = 1;
    uint8 private constant FIELD_FEE_ASSET = 2;
    uint8 private constant FIELD_FEE_BASIS = 3;
    uint8 private constant FIELD_TOTAL_FEE = 4;
    uint8 private constant FIELD_BUILDER = 5;
    uint8 private constant FIELD_PROGRAMMABLE = 6;
    uint8 private constant FIELD_HOLDERS = 7;
    uint8 private constant FIELD_LEG_SUM = 8;
    uint8 private constant FIELD_LEGS_HASH = 9;
    uint8 private constant FIELD_POLICY_HASH = 10;

    function validateAndHash(
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 calldata policy,
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] calldata orderedLegs
    ) internal pure returns (bytes32 policyHash) {
        if (policy.profileKey != PROFILE_KEY) _invalid(FIELD_PROFILE);
        if (policy.feeAsset != address(0)) _invalid(FIELD_FEE_ASSET);
        if (policy.feeBasisHash != FEE_BASIS_HASH) _invalid(FIELD_FEE_BASIS);
        if (policy.totalFeeBps != TOTAL_FEE_BPS) _invalid(FIELD_TOTAL_FEE);

        bytes32 builderHash = hashLeg(orderedLegs[0]);
        bytes32 programmableHash = hashLeg(orderedLegs[1]);
        bytes32 holderHash = hashLeg(orderedLegs[2]);
        if (builderHash != BUILDER_LEG_HASH) _invalid(FIELD_BUILDER);
        if (programmableHash != PROGRAMMABLE_LEG_HASH) _invalid(FIELD_PROGRAMMABLE);
        if (holderHash != HOLDER_LEG_HASH) _invalid(FIELD_HOLDERS);

        uint256 legSum =
            uint256(orderedLegs[0].feeBps) + uint256(orderedLegs[1].feeBps) + uint256(orderedLegs[2].feeBps);
        if (legSum != policy.totalFeeBps) _invalid(FIELD_LEG_SUM);

        bytes32 legsHash = keccak256(abi.encode(builderHash, programmableHash, holderHash));
        if (legsHash != LEGS_HASH || policy.legsHash != legsHash) _invalid(FIELD_LEGS_HASH);

        policyHash = hashPolicy(policy);
        if (policyHash != REVENUE_POLICY_HASH) _invalid(FIELD_POLICY_HASH);
    }

    function hashLeg(IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1 calldata leg)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(LEG_TYPEHASH, leg.roleHash, leg.feeBps, leg.recipient, leg.recipientModeHash));
    }

    function hashPolicy(IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 calldata policy)
        internal
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

    function _invalid(uint8 field) private pure {
        revert IProgrammableExactShardsFeePolicyVerifierV1.InvalidShardsFeePolicy(field);
    }
}

/// @title ProgrammableExactShardsFeePolicyVerifierV1
/// @notice Stateless verifier for the exact reviewed Shards 1.00% inclusive, three-claim policy.
/// @dev Reproduces the typed hashes already frozen in the reviewed nested-factory route artifact. It does not
///      authorize, register, deploy or activate a launch; a registry successor must bind this exact verifier.
contract ProgrammableExactShardsFeePolicyVerifierV1 is IProgrammableExactShardsFeePolicyVerifierV1 {
    bytes32 public constant LEG_TYPEHASH = ProgrammableExactShardsFeePolicyVerifierLibV1.LEG_TYPEHASH;
    bytes32 public constant POLICY_TYPEHASH = ProgrammableExactShardsFeePolicyVerifierLibV1.POLICY_TYPEHASH;

    bytes20 public constant REVIEWED_SOURCE_COMMIT = hex"91b38f3de64d96cac7e29f127c004f128fc1da59";
    bytes20 public constant REVIEWED_SOURCE_TREE = hex"92d6def8609e829487adea66c13901734e43c8c7";
    bytes32 public constant SOURCE_REVISION_HASH = 0x3352fe14662ce467e98f475cf91f10304ce4d69b6342fae4bf3dc968c494d6dc;
    bytes32 public constant NESTED_FACTORY_ARTIFACT_SHA256 =
        0x066475058bfd47b85b4216f95b434756d67d7e289ffb36535c121ef5d7c11bab;
    bytes32 public constant REVIEWED_FEE_DESCRIPTOR_SHA256 =
        0xd1c911686afc62b70f3d65c9807e89146d119c4e6f4604e72d3dab2b4ef8dc22;

    bytes20 public constant ROUTER_V4_SOURCE_COMMIT = hex"d6cfb78543b159f9e0ed9f193a5b29637bd817fc";
    bytes20 public constant ROUTER_V4_SOURCE_TREE = hex"cbdad7210dee6fac708d2957e9f5288090bb20f8";
    bytes20 public constant ROUTER_V4_PROFILE_SOURCE_BLOB = hex"d802fa387505da47a0ac4d65a6e5b5e4efa7026d";
    bytes20 public constant ROUTER_V4_NESTED_ADAPTER_SOURCE_BLOB = hex"cf2b92f67ec00b0c0a844708dd62ab70a32fdf3a";

    bytes32 public constant PROFILE_KEY = ProgrammableExactShardsFeePolicyVerifierLibV1.PROFILE_KEY;
    address public constant FACTORY = 0x9442a520e7b31D10177C75A363355C2C29141ac5;
    bytes32 public constant FACTORY_RUNTIME_CODE_HASH =
        0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5;
    address public constant HOOK = ProgrammableExactShardsFeePolicyVerifierLibV1.HOLDER_ACCUMULATOR;
    bytes32 public constant HOOK_RUNTIME_CODE_HASH = 0x2a2174aff52c3ea9ddf0a6081464c9c6dbc43ddc93609c74d9610f50f486c1e1;

    address public constant FEE_ASSET = address(0);
    bytes32 public constant FEE_BASIS_HASH = ProgrammableExactShardsFeePolicyVerifierLibV1.FEE_BASIS_HASH;
    uint16 public constant TOTAL_FEE_BPS = ProgrammableExactShardsFeePolicyVerifierLibV1.TOTAL_FEE_BPS;
    uint16 public constant SHARE_DENOMINATOR_BPS = 10_000;
    uint16 public constant HOLDER_SHARE_OF_FEE_BPS = 8000;
    uint16 public constant BUILDER_SHARE_OF_FEE_BPS = 1000;
    uint16 public constant PROGRAMMABLE_SHARE_OF_FEE_BPS = 1000;

    bytes32 public constant BUILDER_ROLE_HASH = ProgrammableExactShardsFeePolicyVerifierLibV1.BUILDER_ROLE_HASH;
    bytes32 public constant BUILDER_RECIPIENT_MODE_HASH =
        ProgrammableExactShardsFeePolicyVerifierLibV1.BUILDER_RECIPIENT_MODE_HASH;
    address public constant INITIAL_BUILDER_RECIPIENT =
        ProgrammableExactShardsFeePolicyVerifierLibV1.INITIAL_BUILDER_RECIPIENT;
    uint16 public constant BUILDER_FEE_BPS = ProgrammableExactShardsFeePolicyVerifierLibV1.BUILDER_FEE_BPS;

    bytes32 public constant PROGRAMMABLE_ROLE_HASH =
        ProgrammableExactShardsFeePolicyVerifierLibV1.PROGRAMMABLE_ROLE_HASH;
    bytes32 public constant PROGRAMMABLE_RECIPIENT_MODE_HASH =
        ProgrammableExactShardsFeePolicyVerifierLibV1.PROGRAMMABLE_RECIPIENT_MODE_HASH;
    address public constant PROGRAMMABLE_RECIPIENT =
        ProgrammableExactShardsFeePolicyVerifierLibV1.PROGRAMMABLE_RECIPIENT;
    uint16 public constant PROGRAMMABLE_FEE_BPS = ProgrammableExactShardsFeePolicyVerifierLibV1.PROGRAMMABLE_FEE_BPS;

    bytes32 public constant HOLDER_ROLE_HASH = ProgrammableExactShardsFeePolicyVerifierLibV1.HOLDER_ROLE_HASH;
    bytes32 public constant HOLDER_RECIPIENT_MODE_HASH =
        ProgrammableExactShardsFeePolicyVerifierLibV1.HOLDER_RECIPIENT_MODE_HASH;
    address public constant HOLDER_ACCUMULATOR = ProgrammableExactShardsFeePolicyVerifierLibV1.HOLDER_ACCUMULATOR;
    uint16 public constant HOLDER_FEE_BPS = ProgrammableExactShardsFeePolicyVerifierLibV1.HOLDER_FEE_BPS;

    bytes32 public constant BUILDER_LEG_HASH = ProgrammableExactShardsFeePolicyVerifierLibV1.BUILDER_LEG_HASH;
    bytes32 public constant PROGRAMMABLE_LEG_HASH = ProgrammableExactShardsFeePolicyVerifierLibV1.PROGRAMMABLE_LEG_HASH;
    bytes32 public constant HOLDER_LEG_HASH = ProgrammableExactShardsFeePolicyVerifierLibV1.HOLDER_LEG_HASH;
    bytes32 public constant LEGS_HASH = ProgrammableExactShardsFeePolicyVerifierLibV1.LEGS_HASH;
    bytes32 public constant REVENUE_POLICY_HASH = ProgrammableExactShardsFeePolicyVerifierLibV1.REVENUE_POLICY_HASH;
    bytes32 public constant INITIAL_REVENUE_STATE_HASH =
        0xf0bc686422736754322da4ea358a823274df35c35718939d71d339a41b8f9b75;

    bytes4 public constant HOLDER_CLAIM_SELECTOR = bytes4(keccak256("claim(uint256[])"));
    bytes4 public constant BUILDER_CLAIM_SELECTOR = bytes4(keccak256("claimBuilderFees()"));
    bytes4 public constant PROGRAMMABLE_CLAIM_SELECTOR = bytes4(keccak256("claimLauncherFees()"));
    bytes4 public constant BUILDER_HANDOFF_SELECTOR = bytes4(keccak256("setBuilderFeeRecipient(address)"));

    bytes32 public constant SOURCE_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsSourceBindingV1(bytes20 sourceCommit,bytes20 sourceTree,bytes32 sourceRevisionHash,bytes32 nestedFactoryArtifactSha256,bytes32 feeDescriptorSha256)"
    );
    bytes32 public constant ROUTER_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsRouterBindingV1(bytes20 routerSourceCommit,bytes20 routerSourceTree,bytes20 profileSourceBlob,bytes20 nestedAdapterSourceBlob)"
    );
    bytes32 public constant ECONOMICS_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsEconomicsBindingV1(bytes32 profileKey,address factory,bytes32 factoryRuntimeCodeHash,address hook,bytes32 hookRuntimeCodeHash,bytes32 revenuePolicyHash,bytes32 initialRevenueStateHash)"
    );
    bytes32 public constant FEE_POLICY_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactShardsFeePolicyBindingV1(bytes32 sourceBindingHash,bytes32 routerBindingHash,bytes32 economicsBindingHash)"
    );

    function verify(ProgrammableRevenuePolicyV1 calldata policy, ProgrammableRevenueLegV1[3] calldata orderedLegs)
        external
        pure
        returns (bytes32 policyHash)
    {
        return ProgrammableExactShardsFeePolicyVerifierLibV1.validateAndHash(policy, orderedLegs);
    }

    function hashLeg(ProgrammableRevenueLegV1 calldata leg) external pure returns (bytes32) {
        return ProgrammableExactShardsFeePolicyVerifierLibV1.hashLeg(leg);
    }

    function hashPolicy(ProgrammableRevenuePolicyV1 calldata policy) external pure returns (bytes32) {
        return ProgrammableExactShardsFeePolicyVerifierLibV1.hashPolicy(policy);
    }

    function feePolicyBindingHashV1() external pure returns (bytes32) {
        bytes32 sourceBindingHash = keccak256(
            abi.encode(
                SOURCE_BINDING_TYPEHASH,
                REVIEWED_SOURCE_COMMIT,
                REVIEWED_SOURCE_TREE,
                SOURCE_REVISION_HASH,
                NESTED_FACTORY_ARTIFACT_SHA256,
                REVIEWED_FEE_DESCRIPTOR_SHA256
            )
        );
        bytes32 routerBindingHash = keccak256(
            abi.encode(
                ROUTER_BINDING_TYPEHASH,
                ROUTER_V4_SOURCE_COMMIT,
                ROUTER_V4_SOURCE_TREE,
                ROUTER_V4_PROFILE_SOURCE_BLOB,
                ROUTER_V4_NESTED_ADAPTER_SOURCE_BLOB
            )
        );
        bytes32 economicsBindingHash = keccak256(
            abi.encode(
                ECONOMICS_BINDING_TYPEHASH,
                PROFILE_KEY,
                FACTORY,
                FACTORY_RUNTIME_CODE_HASH,
                HOOK,
                HOOK_RUNTIME_CODE_HASH,
                REVENUE_POLICY_HASH,
                INITIAL_REVENUE_STATE_HASH
            )
        );
        return keccak256(
            abi.encode(FEE_POLICY_BINDING_TYPEHASH, sourceBindingHash, routerBindingHash, economicsBindingHash)
        );
    }
}
