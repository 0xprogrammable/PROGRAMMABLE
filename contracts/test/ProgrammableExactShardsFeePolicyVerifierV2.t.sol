// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableExactShardsFeePolicyVerifierV2 } from "../src/ProgrammableExactShardsFeePolicyVerifierV2.sol";
import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "../src/interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";

contract ProgrammableExactShardsFeePolicyVerifierV2Test is Test {
    ProgrammableExactShardsFeePolicyVerifierV2 private verifier;

    function setUp() external {
        verifier = new ProgrammableExactShardsFeePolicyVerifierV2();
    }

    function test_exactReviewedEconomicTemplateAndBindingMatchV2Manifest() external view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/spec/shards-fee-policy-verifier-v2.json"));
        assertEq(vm.parseJsonString(json, ".schemaVersion"), "programmable.exact-shards-fee-policy-verifier.v2");
        assertEq(vm.parseJsonString(json, ".status"), "SOURCE_CANDIDATE_NOT_DEPLOYED");
        assertFalse(vm.parseJsonBool(json, ".activationAllowed"));
        assertFalse(vm.parseJsonBool(json, ".launchAllowed"));
        assertFalse(vm.parseJsonBool(json, ".externalActionOccurred"));
        assertEq(vm.parseJsonUint(json, ".exactPolicy.totalFeeBps"), verifier.TOTAL_FEE_BPS());
        assertEq(vm.parseJsonBytes32(json, ".exactPolicy.economicTemplateHash"), verifier.economicTemplateHashV1());
        assertEq(vm.parseJsonBytes32(json, ".exactPolicy.feePolicyBindingHash"), verifier.feePolicyBindingHashV2());
        assertEq(verifier.economicTemplateHashV1(), verifier.EXPECTED_ECONOMIC_TEMPLATE_HASH());
        assertEq(verifier.feePolicyBindingHashV2(), verifier.EXPECTED_FEE_POLICY_BINDING_HASH());
        assertEq(
            keccak256(type(ProgrammableExactShardsFeePolicyVerifierV2).creationCode),
            vm.parseJsonBytes32(json, ".components[0].artifact.creationTemplateKeccak256")
        );
        assertEq(
            keccak256(type(ProgrammableExactShardsFeePolicyVerifierV2).runtimeCode),
            vm.parseJsonBytes32(json, ".components[0].artifact.runtimeTemplateKeccak256")
        );
    }

    function test_exactThreeClaimSplitAcceptsOnlyJitNonzeroHolderAccumulator() external {
        address holder = address(0xBEEF);
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] memory legs = _legs(holder);
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 memory policy = _policy(legs);
        assertEq(verifier.verify(policy, legs), verifier.hashPolicy(policy));

        legs[2].recipient = address(0);
        policy = _policy(legs);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsFeePolicyVerifierV2.InvalidShardsFeePolicy.selector, 7)
        );
        verifier.verify(policy, legs);
    }

    function test_everyEconomicTemplateFieldMutationFailsClosed() external {
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] memory legs = _legs(address(0xBEEF));
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 memory policy = _policy(legs);

        policy.totalFeeBps += 1;
        _expectField(4);
        verifier.verify(policy, legs);

        policy = _policy(legs);
        legs[0].feeBps += 1;
        policy = _policy(legs);
        _expectField(5);
        verifier.verify(policy, legs);

        legs = _legs(address(0xBEEF));
        legs[1].recipient = address(0xCAFE);
        policy = _policy(legs);
        _expectField(6);
        verifier.verify(policy, legs);

        legs = _legs(address(0xBEEF));
        legs[2].recipientModeHash = keccak256("wrong-holder-mode");
        policy = _policy(legs);
        _expectField(7);
        verifier.verify(policy, legs);

        legs = _legs(address(0xBEEF));
        policy = _policy(legs);
        policy.legsHash = keccak256("wrong-legs-hash");
        _expectField(9);
        verifier.verify(policy, legs);
    }

    function _legs(address holder)
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
            recipient: holder,
            recipientModeHash: verifier.HOLDER_RECIPIENT_MODE_HASH()
        });
    }

    function _policy(IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] memory legs)
        private
        view
        returns (IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 memory policy)
    {
        policy.profileKey = verifier.PROFILE_KEY();
        policy.feeAsset = address(0);
        policy.feeBasisHash = verifier.FEE_BASIS_HASH();
        policy.totalFeeBps = verifier.TOTAL_FEE_BPS();
        policy.legsHash =
            keccak256(abi.encode(verifier.hashLeg(legs[0]), verifier.hashLeg(legs[1]), verifier.hashLeg(legs[2])));
    }

    function _expectField(uint8 field) private {
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsFeePolicyVerifierV2.InvalidShardsFeePolicy.selector, field)
        );
    }
}
