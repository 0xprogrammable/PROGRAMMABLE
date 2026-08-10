// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableCompletedGraphAdoptionCompatV1,
    IProgrammableCompletedGraphAdoptionPreflightV1
} from "./IProgrammableCompletedGraphAdoptionCompatV1.sol";
import {ProgrammableCompletedGraphAdoptionCompatCodecV1} from "./ProgrammableCompletedGraphAdoptionCompatCodecV1.sol";

/// @notice Immutable side-effect-free preflight projection for the completed-graph ADOPT Registry.
/// @dev It reads only the exact typed Registry state source, derives canonical hashes with the pinned Codec and has
///      no signing, reservation, execution, target, selector, calldata, value, approval, CREATE or delegatecall path.
contract ProgrammableCompletedGraphAdoptionPreflightV1 is IProgrammableCompletedGraphAdoptionPreflightV1 {
    bytes32 public constant PREFLIGHT_ID_HASH = keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_PREFLIGHT_V1");
    uint16 private constant REQUIRED_RUNTIME_MASK = (1 << 9) - 1;

    address public immutable override CODEC;
    bytes32 public immutable CODEC_RUNTIME_CODE_HASH;

    error InvalidPreflight(uint8 field);

    constructor(address codec) {
        if (
            codec.code.length == 0
                || ProgrammableCompletedGraphAdoptionCompatCodecV1(codec).CODEC_ID_HASH()
                    != keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_COMPAT_CODEC_V1")
        ) revert InvalidPreflight(1);
        CODEC = codec;
        CODEC_RUNTIME_CODE_HASH = codec.codehash;
    }

    function adoptionPreflightReadbackV1(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 calldata query,
        bytes32 candidateCurrentnessDigest
    ) external view override returns (IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory) {
        return _adoptionPreflightReadback(registry, query, candidateCurrentnessDigest);
    }

    function _adoptionPreflightReadback(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query,
        bytes32 candidateCurrentnessDigest
    ) private view returns (IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory r) {
        _requireCodec();
        IProgrammableCompletedGraphAdoptionCompatV1 source = IProgrammableCompletedGraphAdoptionCompatV1(registry);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightControlStateV1 memory control =
            source.preflightControlStateV1(query.profileKey);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightGrantReceiptStateV1 memory lifecycle =
            source.preflightGrantReceiptStateV1(query, candidateCurrentnessDigest);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightComponentStateV1 memory component =
            source.preflightComponentStateV1(query.component);

        r.chainId = block.chainid;
        r.registry = registry;
        r.runtimeAuthorityBindingHash = control.runtimeAuthorityBindingHash;
        r.liveRuntimeMask = control.liveRuntimeMask;
        r.dependencyBehaviorEvidenceHash = control.dependencyBehaviorEvidenceHash;
        r.securityControlHeadHash = control.securityControlHeadHash;
        r.securityEpoch = control.securityEpoch;
        r.securityEpochHash = control.securityEpochHash;
        r.policyEpoch = control.policyEpoch;
        r.policyEpochHash = control.policyEpochHash;
        r.reviewControl = control.reviewControl;
        r.globalAdoptionKilled = control.globalAdoptionKilled;
        r.profileStatus = control.profileStatus;
        r.profileCapabilityHash = control.profileCapabilityHash;
        r.grantStateHead = lifecycle.grantStateHead;
        r.winnerNonceOccupantGrantDigest = lifecycle.winnerNonceOccupantGrantDigest;
        r.winnerKeyOccupantGrantDigest = lifecycle.winnerKeyOccupantGrantDigest;
        r.currentnessRevoked = lifecycle.currentnessRevoked;
        r.currentnessUsed = lifecycle.currentnessUsed;
        r.currentnessNonceUsed = lifecycle.currentnessNonceUsed;
        r.receiptStatus = lifecycle.receiptStatus;
        r.receiptCoreHash = lifecycle.receiptCoreHash;
        r.finalityIndexingReceiptHash = lifecycle.finalityIndexingReceiptHash;
        r.graphOccupantStampLaunchId = lifecycle.graphOccupantStampLaunchId;
        r.exclusiveTokenOccupantStampLaunchId = lifecycle.exclusiveTokenOccupantStampLaunchId;
        r.poolOccupantStampLaunchId = lifecycle.poolOccupantStampLaunchId;
        r.exclusiveComponentOccupantStampLaunchId = component.exclusiveComponentOccupantStampLaunchId;
        r.sharedComponentIdentityHash = component.sharedComponentIdentityHash;
        r.actualComponentRuntimeCodeHash = component.actualComponentRuntimeCodeHash;
        ProgrammableCompletedGraphAdoptionCompatCodecV1 codec = ProgrammableCompletedGraphAdoptionCompatCodecV1(CODEC);
        r.queryHash = codec.computeAdoptionPreflightQueryHash(query);
        r.componentLeafHash = codec.computeAdoptionPreflightComponentLeafHash(
            query,
            r.actualComponentRuntimeCodeHash,
            r.exclusiveComponentOccupantStampLaunchId,
            r.sharedComponentIdentityHash
        );
        r.globalReadbackHeadHash = codec.computeAdoptionPreflightGlobalHeadHash(r);
    }

    function computeAdoptionPreflightAggregateV1(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphAdoptionV1 calldata adoption,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability,
        bytes32 grantDigest,
        bytes32 contractPlanHash
    ) external view override returns (bytes32) {
        _requireCodec();
        ProgrammableCompletedGraphAdoptionCompatCodecV1 codec = ProgrammableCompletedGraphAdoptionCompatCodecV1(CODEC);
        if (adoption.components.length == 0 || adoption.components.length > codec.MAX_COMPONENTS()) {
            revert InvalidPreflight(3);
        }

        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query;
        query.profileKey = adoption.plan.profileKey;
        query.launchGrantDigest = grantDigest;
        query.expectedContractPlanHash = contractPlanHash;
        query.stampLaunchId = adoption.request.stampLaunchId;
        query.antiReplayNonce = adoption.grant.antiReplayNonce;
        query.winnerKeyHash = adoption.grant.winnerKeyHash;
        query.componentGraphHash = adoption.plan.componentGraphHash;
        query.exclusiveToken = adoption.plan.identities.token;
        query.poolManager = adoption.plan.poolManager;
        query.poolId = adoption.plan.poolId;
        query.currentnessNonce = adoption.currentness.nonce;

        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory r =
            _adoptionPreflightReadback(registry, query, bytes32(0));
        if (
            r.liveRuntimeMask != REQUIRED_RUNTIME_MASK || r.globalAdoptionKilled
                || r.profileStatus != IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Active
                || r.profileCapabilityHash != codec.computeAdoptionProfileCapabilityHash(capability)
                || r.grantStateHead.status != IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active
                || r.grantStateHead.grantDigest != grantDigest
                || r.grantStateHead.grantHash != codec.computeLaunchGrantHash(adoption.grant)
                || r.grantStateHead.stampLaunchId != adoption.request.stampLaunchId
                || r.winnerNonceOccupantGrantDigest != grantDigest || r.winnerKeyOccupantGrantDigest != grantDigest
                || r.currentnessNonceUsed
                || r.receiptStatus != IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Prepared
                || r.receiptCoreHash != bytes32(0) || r.finalityIndexingReceiptHash != bytes32(0)
                || r.graphOccupantStampLaunchId != bytes32(0) || r.exclusiveTokenOccupantStampLaunchId != bytes32(0)
                || r.poolOccupantStampLaunchId != bytes32(0)
        ) revert InvalidPreflight(4);

        bytes32[] memory leaves = new bytes32[](adoption.components.length);
        for (uint256 i; i < adoption.components.length; ++i) {
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component = adoption.components[i];
            // The Codec-enforced component cap is 24, so the index cannot truncate.
            // forge-lint: disable-next-line(unsafe-typecast)
            query.componentIndex = uint8(i);
            query.component = component.account;
            query.componentScope = component.scope;
            query.expectedSharedIdentityHash = component.scope
                == IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.SharedInfrastructure
                ? codec.computeSharedComponentIdentityHash(component)
                : bytes32(0);
            query.expectedRuntimeCodeHash = component.runtimeCodeHash;
            IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory leaf =
                _adoptionPreflightReadback(registry, query, bytes32(0));
            if (
                leaf.actualComponentRuntimeCodeHash != component.runtimeCodeHash
                    || leaf.exclusiveComponentOccupantStampLaunchId != bytes32(0)
                    || (component.scope == IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.Exclusive
                        && leaf.sharedComponentIdentityHash != bytes32(0))
                    || (component.scope
                            == IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.SharedInfrastructure
                        && leaf.sharedComponentIdentityHash != bytes32(0)
                        && leaf.sharedComponentIdentityHash != query.expectedSharedIdentityHash)
            ) revert InvalidPreflight(5);
            leaves[i] = leaf.componentLeafHash;
        }
        return codec.computeAdoptionPreflightReadbackHash(r.globalReadbackHeadHash, keccak256(abi.encodePacked(leaves)));
    }

    function _requireCodec() private view {
        if (CODEC.codehash != CODEC_RUNTIME_CODE_HASH) revert InvalidPreflight(6);
    }
}
