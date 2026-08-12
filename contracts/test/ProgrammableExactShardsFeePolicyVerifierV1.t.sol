// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableExactShardsFeePolicyVerifierV1 } from "../src/ProgrammableExactShardsFeePolicyVerifierV1.sol";
import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "../src/interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";

contract ProgrammableExactShardsFeePolicyVerifierV1Test is Test {
    ProgrammableExactShardsFeePolicyVerifierV1 private verifier;

    function setUp() external {
        verifier = new ProgrammableExactShardsFeePolicyVerifierV1();
    }

    function testCanonicalPolicyReproducesReviewedArtifactHashes() external view {
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] memory legs = _legs();
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 memory policy = _policy();

        assertEq(verifier.hashLeg(legs[0]), verifier.BUILDER_LEG_HASH());
        assertEq(verifier.hashLeg(legs[1]), verifier.PROGRAMMABLE_LEG_HASH());
        assertEq(verifier.hashLeg(legs[2]), verifier.HOLDER_LEG_HASH());
        assertEq(
            keccak256(
                abi.encode(verifier.BUILDER_LEG_HASH(), verifier.PROGRAMMABLE_LEG_HASH(), verifier.HOLDER_LEG_HASH())
            ),
            verifier.LEGS_HASH()
        );
        assertEq(verifier.hashPolicy(policy), verifier.REVENUE_POLICY_HASH());
        assertEq(verifier.verify(policy, legs), verifier.REVENUE_POLICY_HASH());
    }

    function testCanonicalPolicyIsInclusiveOnePercentAndThreeClaims() external view {
        assertEq(verifier.TOTAL_FEE_BPS(), 100);
        assertEq(verifier.HOLDER_FEE_BPS(), 80);
        assertEq(verifier.BUILDER_FEE_BPS(), 10);
        assertEq(verifier.PROGRAMMABLE_FEE_BPS(), 10);
        assertEq(verifier.HOLDER_SHARE_OF_FEE_BPS(), 8000);
        assertEq(verifier.BUILDER_SHARE_OF_FEE_BPS(), 1000);
        assertEq(verifier.PROGRAMMABLE_SHARE_OF_FEE_BPS(), 1000);
        assertEq(verifier.FEE_ASSET(), address(0));
        assertEq(verifier.HOLDER_ACCUMULATOR(), verifier.HOOK());
        assertEq(verifier.PROGRAMMABLE_RECIPIENT(), 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c);
        assertEq(verifier.INITIAL_BUILDER_RECIPIENT(), 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC);
        assertTrue(verifier.BUILDER_RECIPIENT_MODE_HASH() != verifier.PROGRAMMABLE_RECIPIENT_MODE_HASH());
        assertTrue(verifier.HOLDER_RECIPIENT_MODE_HASH() != verifier.BUILDER_RECIPIENT_MODE_HASH());
    }

    function testBindingPinsReviewedSourceRouteAndRouterV4() external view {
        assertTrue(verifier.REVIEWED_SOURCE_COMMIT() == hex"91b38f3de64d96cac7e29f127c004f128fc1da59");
        assertTrue(verifier.REVIEWED_SOURCE_TREE() == hex"92d6def8609e829487adea66c13901734e43c8c7");
        assertEq(
            verifier.NESTED_FACTORY_ARTIFACT_SHA256(),
            0x066475058bfd47b85b4216f95b434756d67d7e289ffb36535c121ef5d7c11bab
        );
        assertTrue(verifier.ROUTER_V4_SOURCE_COMMIT() == hex"d6cfb78543b159f9e0ed9f193a5b29637bd817fc");
        assertTrue(verifier.ROUTER_V4_PROFILE_SOURCE_BLOB() == hex"d802fa387505da47a0ac4d65a6e5b5e4efa7026d");
        assertTrue(verifier.ROUTER_V4_NESTED_ADAPTER_SOURCE_BLOB() == hex"cf2b92f67ec00b0c0a844708dd62ab70a32fdf3a");
        assertEq(
            verifier.INITIAL_REVENUE_STATE_HASH(), 0xf0bc686422736754322da4ea358a823274df35c35718939d71d339a41b8f9b75
        );
        assertEq(verifier.feePolicyBindingHashV1(), 0x5d5d1c46e7627f6e171a18acdbecbfe9e40eca80016fba0142ddca6a054f6169);
    }

    function testSelectorsBindThreeClaimsAndBuilderSelfHandoff() external view {
        assertEq(verifier.HOLDER_CLAIM_SELECTOR(), bytes4(0x6ba4c138));
        assertEq(verifier.BUILDER_CLAIM_SELECTOR(), bytes4(0x69f9a5f0));
        assertEq(verifier.PROGRAMMABLE_CLAIM_SELECTOR(), bytes4(0x64d46b85));
        assertEq(verifier.BUILDER_HANDOFF_SELECTOR(), bytes4(0x4ce11d21));
    }

    function testMachineCheckableSpecMatchesPolicyAndBytecode() external view {
        string memory root = vm.projectRoot();
        string memory json = vm.readFile(string.concat(root, "/spec/shards-fee-policy-verifier-v1.json"));

        assertEq(vm.parseJsonString(json, ".schemaVersion"), "programmable.exact-shards-fee-policy-verifier.v1");
        assertEq(vm.parseJsonString(json, ".status"), "IMPLEMENTATION_READY_NOT_DEPLOYED");
        assertFalse(vm.parseJsonBool(json, ".activationAllowed"));
        assertFalse(vm.parseJsonBool(json, ".launchAllowed"));
        assertFalse(vm.parseJsonBool(json, ".decision.currentContractsCanLaunch"));
        assertFalse(vm.parseJsonBool(json, ".uiMetadataBoundary.feePolicyIncludesTokenName"));
        assertFalse(vm.parseJsonBool(json, ".uiMetadataBoundary.feePolicyIncludesTokenSymbol"));
        assertFalse(vm.parseJsonBool(json, ".uiMetadataBoundary.feePolicyIncludesPresentationBindingHash"));
        assertFalse(vm.parseJsonBool(json, ".uiMetadataBoundary.presentationValuesAreSourceArtifactInputs"));
        assertEq(
            vm.parseJsonString(json, ".uiMetadataBoundary.economicsRemainExactly"), "INCLUSIVE_100_BPS_SPLIT_10_10_80"
        );
        assertEq(vm.parseJsonBytes32(json, ".canonicalPolicy.revenuePolicyHash"), verifier.REVENUE_POLICY_HASH());
        assertEq(vm.parseJsonBytes32(json, ".typedHashSpec.feePolicyBindingHash"), verifier.feePolicyBindingHashV1());

        assertEq(
            keccak256(type(ProgrammableExactShardsFeePolicyVerifierV1).creationCode),
            vm.parseJsonBytes32(json, ".implementation.artifact.creationCodeKeccak256")
        );
        assertEq(
            keccak256(type(ProgrammableExactShardsFeePolicyVerifierV1).runtimeCode),
            vm.parseJsonBytes32(json, ".implementation.artifact.runtimeCodeKeccak256")
        );
        assertEq(
            type(ProgrammableExactShardsFeePolicyVerifierV1).creationCode.length,
            vm.parseJsonUint(json, ".implementation.artifact.creationCodeByteLength")
        );
        assertEq(
            type(ProgrammableExactShardsFeePolicyVerifierV1).runtimeCode.length,
            vm.parseJsonUint(json, ".implementation.artifact.runtimeCodeByteLength")
        );
    }

    function testRejectsProfileAssetBasisAndTotalDrift() external {
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] memory legs = _legs();
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 memory policy = _policy();

        policy.profileKey = keccak256("wrong-profile");
        _expectField(1);
        verifier.verify(policy, legs);

        policy = _policy();
        policy.feeAsset = address(1);
        _expectField(2);
        verifier.verify(policy, legs);

        policy = _policy();
        policy.feeBasisHash = keccak256("added-on-top");
        _expectField(3);
        verifier.verify(policy, legs);

        policy = _policy();
        policy.totalFeeBps = 101;
        _expectField(4);
        verifier.verify(policy, legs);
    }

    function testRejectsAnyClaimMutationOrReordering() external {
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 memory policy = _policy();
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] memory legs = _legs();

        legs[0].recipient = address(1);
        _expectField(5);
        verifier.verify(policy, legs);

        legs = _legs();
        legs[1].recipientModeHash = keccak256("mutable-programmable");
        _expectField(6);
        verifier.verify(policy, legs);

        legs = _legs();
        legs[2].recipient = address(2);
        _expectField(7);
        verifier.verify(policy, legs);

        legs = _legs();
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1 memory first = legs[0];
        legs[0] = legs[2];
        legs[2] = first;
        _expectField(5);
        verifier.verify(policy, legs);
    }

    function testRejectsClaimSumAndPrecommittedLegHashDrift() external {
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] memory legs = _legs();
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 memory policy = _policy();

        legs[2].feeBps = 79;
        _expectField(7);
        verifier.verify(policy, legs);

        legs = _legs();
        policy.legsHash = keccak256("collapsed-two-claim-policy");
        _expectField(9);
        verifier.verify(policy, legs);
    }

    function _policy()
        private
        view
        returns (IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 memory policy)
    {
        policy.profileKey = verifier.PROFILE_KEY();
        policy.feeAsset = address(0);
        policy.feeBasisHash = verifier.FEE_BASIS_HASH();
        policy.totalFeeBps = verifier.TOTAL_FEE_BPS();
        policy.legsHash = verifier.LEGS_HASH();
    }

    function _legs()
        private
        view
        returns (IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] memory legs)
    {
        legs[0] = IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1({
            roleHash: verifier.BUILDER_ROLE_HASH(),
            feeBps: verifier.BUILDER_FEE_BPS(),
            recipient: verifier.INITIAL_BUILDER_RECIPIENT(),
            recipientModeHash: verifier.BUILDER_RECIPIENT_MODE_HASH()
        });
        legs[1] = IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1({
            roleHash: verifier.PROGRAMMABLE_ROLE_HASH(),
            feeBps: verifier.PROGRAMMABLE_FEE_BPS(),
            recipient: verifier.PROGRAMMABLE_RECIPIENT(),
            recipientModeHash: verifier.PROGRAMMABLE_RECIPIENT_MODE_HASH()
        });
        legs[2] = IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1({
            roleHash: verifier.HOLDER_ROLE_HASH(),
            feeBps: verifier.HOLDER_FEE_BPS(),
            recipient: verifier.HOLDER_ACCUMULATOR(),
            recipientModeHash: verifier.HOLDER_RECIPIENT_MODE_HASH()
        });
    }

    function _expectField(uint8 field) private {
        vm.expectRevert(
            abi.encodeWithSelector(IProgrammableExactShardsFeePolicyVerifierV1.InvalidShardsFeePolicy.selector, field)
        );
    }
}
