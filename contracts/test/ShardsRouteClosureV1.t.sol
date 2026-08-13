// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { stdJson } from "forge-std/StdJson.sol";
import { Test } from "forge-std/Test.sol";

import {
    ProgrammableCustomFeePolicyVerifierLibV1,
    ProgrammableCustomFeePolicyVerifierV1
} from "../src/ProgrammableCustomFeePolicyVerifierV1.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";

/// @notice Machine-checks the minimum legitimate closure for the exact reviewed Shards route.
/// @dev This is deliberately a proof-only test. It does not introduce a replacement Shards router, factory or hook.
contract ShardsRouteClosureV1Test is Test {
    using stdJson for string;

    string private constant SPEC_PATH = "spec/shards-route-closure-v1.json";

    address private constant PROGRAMMABLE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address private constant INITIAL_BUILDER_RECIPIENT = 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;

    bytes32 private constant EXACT_SHARDS_SOURCE_REVISION_HASH =
        0x3352fe14662ce467e98f475cf91f10304ce4d69b6342fae4bf3dc968c494d6dc;
    bytes32 private constant EXACT_SHARDS_ROUTE_ARTIFACT_SHA256 =
        0x066475058bfd47b85b4216f95b434756d67d7e289ffb36535c121ef5d7c11bab;
    bytes32 private constant EXACT_SHARDS_PROFILE_KEY =
        0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    bytes32 private constant EXACT_SHARDS_REVENUE_POLICY_HASH =
        0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2;
    bytes32 private constant EXACT_SHARDS_INITIAL_REVENUE_STATE_HASH =
        0xf0bc686422736754322da4ea358a823274df35c35718939d71d339a41b8f9b75;

    bytes32 private constant REVENUE_POLICY_STATE_TYPEHASH = keccak256(
        "ProgrammableExactShardsRevenuePolicyStateV1(bytes32 revenuePolicyHash,address launcherFeeRecipient,address builderFeeRecipient,uint16 holderShareBps,uint16 builderShareBps,uint16 launcherShareBps)"
    );
    bytes32 private constant REVENUE_COUNTER_STATE_TYPEHASH = keccak256(
        "ProgrammableExactShardsRevenueCounterStateV1(uint256 builderFeesAccrued,uint256 launcherFeesAccrued,uint256 accFeePerNft,uint256 dustScaled,uint256 releasedDustScaled,uint256 escrowBalance,uint256 circulating,uint256 pendingCount)"
    );
    bytes32 private constant REVENUE_STATE_TYPEHASH =
        keccak256("ProgrammableExactShardsRevenueStateV1(bytes32 policyStateHash,bytes32 counterStateHash)");

    bytes32 private constant REASON_NATIVE = keccak256("fee-policy.native");
    bytes32 private constant REASON_PARTNER = keccak256("fee-policy.partner");
    bytes32 private constant REASON_NO_QUALIFYING_MARKET = keccak256("fee-policy.no-qualifying-market");

    ProgrammableCustomFeePolicyVerifierV1 private verifier;
    string private closure;

    function setUp() public {
        verifier = new ProgrammableCustomFeePolicyVerifierV1();
        closure = vm.readFile(SPEC_PATH);
    }

    function test_artifactPinsReviewedSourceRouteAndInclusiveEconomics() public view {
        assertEq(closure.readString(".reviewedSource.commit"), "91b38f3de64d96cac7e29f127c004f128fc1da59");
        assertEq(closure.readString(".reviewedSource.tree"), "92d6def8609e829487adea66c13901734e43c8c7");
        assertEq(closure.readBytes32(".reviewedSource.sourceRevisionHash"), EXACT_SHARDS_SOURCE_REVISION_HASH);
        assertEq(
            closure.readBytes32(".reviewedRouteEvidence.pullRequest13.artifact.sha256"),
            EXACT_SHARDS_ROUTE_ARTIFACT_SHA256
        );
        assertEq(closure.readBytes32(".routerV4.profileKey"), EXACT_SHARDS_PROFILE_KEY);
        assertEq(closure.readString(".economics.chargeMode"), "INCLUDED_IN_SHARDS_HOOK_FEE");

        uint256 totalFeeBps = closure.readUint(".economics.totalFeeBps");
        uint256 denominator = closure.readUint(".economics.shareDenominatorBps");
        uint256 holderShare = closure.readUint(".economics.holderShareOfFeeBps");
        uint256 builderShare = closure.readUint(".economics.builderShareOfFeeBps");
        uint256 programmableShare = closure.readUint(".economics.programmableShareOfFeeBps");
        assertEq(totalFeeBps, 100);
        assertEq(holderShare + builderShare + programmableShare, denominator);
        assertEq((totalFeeBps * holderShare) / denominator, 80);
        assertEq((totalFeeBps * builderShare) / denominator, 10);
        assertEq((totalFeeBps * programmableShare) / denominator, 10);
        assertEq(closure.readAddress(".economics.programmableRecipient"), PROGRAMMABLE_RECIPIENT);
        assertEq(closure.readAddress(".economics.initialBuilderRecipient"), INITIAL_BUILDER_RECIPIENT);

        assertEq(closure.readBytes32(".economics.revenuePolicyHash"), EXACT_SHARDS_REVENUE_POLICY_HASH);
        assertEq(closure.readBytes32(".economics.initialRevenueStateHash"), _initialRevenueStateHash());
        assertEq(_initialRevenueStateHash(), EXACT_SHARDS_INITIAL_REVENUE_STATE_HASH);
    }

    function test_artifactRequiresRegistryGenerationButNoReplacementShardsRoute() public view {
        assertEq(closure.readString(".decision.option"), "B");
        assertFalse(closure.readBool(".decision.currentContractsCanLaunch"));
        assertFalse(closure.readBool(".decision.newShardsRouteContractRequired"));
        assertTrue(closure.readBool(".decision.newRegistryGenerationRequired"));
        assertFalse(closure.readBool(".decision.reviewedShardsSemanticsChangeRequired"));

        assertEq(closure.readUint(".routerV4.liveObservation.blockNumber"), 25_739_119);
        assertTrue(closure.readBool(".routerV4.liveObservation.kernel.globalKilled"));
        assertFalse(closure.readBool(".routerV4.liveObservation.kernel.exactShardsProfileRegistered"));
        assertEq(closure.readString(".routerV4.liveObservation.components[1].status"), "VACANT");
        assertEq(closure.readString(".routerV4.liveObservation.components[2].status"), "VACANT");
        assertEq(closure.readString(".routerV4.liveObservation.components[3].status"), "VACANT");
        assertEq(closure.readString(".routerV4.liveObservation.components[4].status"), "VACANT");

        assertTrue(closure.readBool(".customRegistryV1.feeVerifier.immutableOnRegistry"));
        assertEq(address(verifier).codehash, closure.readBytes32(".customRegistryV1.feeVerifier.runtimeCodeHash"));
        assertFalse(closure.readBool(".customRegistryV1.exactShardsPolicyRepresentable"));
        assertFalse(closure.readBool(".customRegistryV1.atomicRegistrar.canReproduceExactShardsNestedTopology"));
        assertTrue(closure.readBool(".smallestLegitimateClosure.registrationCanFollowRouterExecution"));
        assertFalse(closure.readBool(".smallestLegitimateClosure.replacementAtomicRegistrarRequired"));
        assertFalse(closure.readBool(".smallestLegitimateClosure.replacementShardsRouterOrFactoryRequired"));
    }

    function test_artifactTypedCommitmentRecomputes() public view {
        bytes32 typeHash = keccak256(bytes(closure.readString(".commitment.type")));
        assertEq(typeHash, closure.readBytes32(".commitment.typeHash"));
        assertEq(_artifactCommitment(typeHash), closure.readBytes32(".commitment.value"));
    }

    function test_registryV1RejectsExactShardsAsNativeCustom() public {
        assertEq(closure.readBytes32(".customRegistryV1.impossibilityWitnesses[0].revertReasonCode"), REASON_NATIVE);
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _exactShardsApproximation();
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NativeCustom;

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector, REASON_NATIVE)
        );
        verifier.verify(policy);
    }

    function test_registryV1RejectsExactShardsAsPartnerTemplate() public {
        assertEq(closure.readBytes32(".customRegistryV1.impossibilityWitnesses[1].revertReasonCode"), REASON_PARTNER);
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _exactShardsApproximation();
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.PartnerTemplate;
        policy.providerId = verifier.AEON_PROVIDER_ID();
        policy.partnerStatusId = verifier.PARTNER_STATUS_ACTIVE_ID();
        policy.partnerRepositoryId = keccak256("shards-reviewed-repository");
        policy.partnerCommitId = EXACT_SHARDS_SOURCE_REVISION_HASH;
        policy.partnerRuntimeCodeSetHash = keccak256("exact-shards-runtime-set");
        policy.activationVersion = keccak256("exact-shards-activation-v1");
        policy.activationBlock = 1;

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector, REASON_PARTNER)
        );
        verifier.verify(policy);
    }

    function test_registryV1RejectsExactShardsAsNoQualifyingMarket() public {
        assertEq(
            closure.readBytes32(".customRegistryV1.impossibilityWitnesses[2].revertReasonCode"),
            REASON_NO_QUALIFYING_MARKET
        );
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _exactShardsApproximation();
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NoQualifyingMarket;

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector, REASON_NO_QUALIFYING_MARKET
            )
        );
        verifier.verify(policy);
    }

    function _exactShardsApproximation()
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy)
    {
        policy.modelId = keccak256("exact-shards-model");
        policy.modelVersion = keccak256("1.0.0");
        policy.templateId = keccak256("exact-shards-nested-factory");
        policy.templateVersion = keccak256("1.0.0");
        policy.marketPathId = keccak256("exact-shards-mainnet-pool");
        policy.totalFeeBps = 100;
        policy.nativeCustomFeeBps = 0;
        // V1 has only partner and programmable slots. Ninety bps is intentionally collapsed here solely to prove
        // that even the closest lossy two-leg encoding is rejected; it is not an acceptable public representation.
        policy.partner = _activeLeg(90, address(0xBEEF), "collapsed-holder-builder");
        policy.programmable = _activeLeg(10, PROGRAMMABLE_RECIPIENT, "programmable");
        policy.partner.chargeModeId = policy.programmable.chargeModeId;
        policy.partner.basisId = policy.programmable.basisId;
        policy.partner.roundingId = policy.programmable.roundingId;
        policy.publicPolicyBindingHash = EXACT_SHARDS_REVENUE_POLICY_HASH;
        policy.claimIsolationEvidenceHash = keccak256("exact-shards-claim-isolation");
        policy.accountingSafetyEvidenceHash = keccak256("exact-shards-accounting-safety");
        policy.verificationEvidenceHash = EXACT_SHARDS_ROUTE_ARTIFACT_SHA256;
    }

    function _activeLeg(uint16 shareBps, address recipient, string memory label)
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeeLegV1 memory leg)
    {
        leg.shareBps = shareBps;
        leg.recipient = recipient;
        leg.currency = address(0);
        leg.chargeModeId = keccak256("included-in-exact-shards-hook-fee");
        leg.basisId = keccak256("settled-exact-shards-swap-volume");
        leg.roundingId = keccak256("carried-cumulative-floor");
        leg.accrualId = keccak256(abi.encodePacked(label, "-accrual"));
        leg.claimId = keccak256(abi.encodePacked(label, "-claim"));
        leg.claimRightId = keccak256(abi.encodePacked(label, "-claim-right"));
        leg.controlEvidenceHash = keccak256(abi.encodePacked(label, "-control"));
    }

    function _initialRevenueStateHash() private pure returns (bytes32) {
        bytes32 policyStateHash = keccak256(
            abi.encode(
                REVENUE_POLICY_STATE_TYPEHASH,
                EXACT_SHARDS_REVENUE_POLICY_HASH,
                PROGRAMMABLE_RECIPIENT,
                INITIAL_BUILDER_RECIPIENT,
                uint16(8000),
                uint16(1000),
                uint16(1000)
            )
        );
        bytes32 counterStateHash = keccak256(
            abi.encode(
                REVENUE_COUNTER_STATE_TYPEHASH,
                uint256(0),
                uint256(0),
                uint256(0),
                uint256(0),
                uint256(0),
                uint256(0),
                uint256(0),
                uint256(0)
            )
        );
        return keccak256(abi.encode(REVENUE_STATE_TYPEHASH, policyStateHash, counterStateHash));
    }

    function _artifactCommitment(bytes32 typeHash) private view returns (bytes32) {
        // Every committed field is a static ABI word, so concatenating these two encoded word groups is exactly the
        // same byte sequence as one abi.encode call while keeping the normal compiler below its stack limit.
        bytes memory reviewedRouteAndEconomics = abi.encode(
            typeHash,
            closure.readBytes32(".reviewedSource.sourceRevisionHash"),
            closure.readBytes32(".reviewedRouteEvidence.pullRequest13.artifact.sha256"),
            closure.readBytes32(".routerV4.profileKey"),
            closure.readBytes32(".economics.revenuePolicyHash"),
            closure.readBytes32(".economics.initialRevenueStateHash"),
            uint16(closure.readUint(".economics.totalFeeBps")),
            uint16(closure.readUint(".economics.holderShareOfFeeBps")),
            uint16(closure.readUint(".economics.builderShareOfFeeBps")),
            uint16(closure.readUint(".economics.programmableShareOfFeeBps"))
        );
        bytes memory deploymentAndDecision = abi.encode(
            closure.readAddress(".customRegistryV1.address"),
            closure.readBytes32(".customRegistryV1.runtimeCodeHash"),
            closure.readAddress(".customRegistryV1.feeVerifier.address"),
            closure.readBytes32(".customRegistryV1.feeVerifier.runtimeCodeHash"),
            uint64(closure.readUint(".routerV4.liveObservation.blockNumber")),
            closure.readBytes32(".routerV4.liveObservation.blockHash"),
            closure.readBool(".decision.currentContractsCanLaunch"),
            closure.readBool(".decision.newShardsRouteContractRequired"),
            closure.readBool(".decision.newRegistryGenerationRequired")
        );
        return keccak256(bytes.concat(reviewedRouteAndEconomics, deploymentAndDecision));
    }
}
