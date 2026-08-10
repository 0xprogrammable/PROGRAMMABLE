// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableCompletedGraphAdoptionCompatV1,
    IProgrammableCompletedGraphAdoptionStateVerifierV1
} from "../../src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol";
import {
    ProgrammableCompletedGraphAdoptionCompatCodecV1
} from "../../src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol";
import {
    ProgrammableCompletedGraphAdoptionValidatorV1
} from "../../src/hookemon/ProgrammableCompletedGraphAdoptionValidatorV1.sol";
import {
    ProgrammableCompletedGraphAdoptionGrantRegistryV1
} from "../../src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol";
import {
    ProgrammableCompletedGraphAdoptionPreflightV1
} from "../../src/hookemon/ProgrammableCompletedGraphAdoptionPreflightV1.sol";

interface VmCompatV1 {
    function warp(uint256 newTimestamp) external;

    function etch(address target, bytes calldata code) external;
}

contract CompatAuthorityV1 {
    uint8 private _signatureMode;
    bytes32 private _expectedDigest;

    function setSignatureMode(uint8 signatureMode) external {
        _signatureMode = signatureMode;
    }

    function setExpectedDigest(bytes32 expectedDigest) external {
        _expectedDigest = expectedDigest;
    }

    function isValidSignature(bytes32 digest, bytes calldata) external view returns (bytes4) {
        if (_signatureMode == 1) return 0xffffffff;
        if (_signatureMode == 2) revert("compat authority revert");
        if (_signatureMode == 3) {
            assembly ("memory-safe") {
                mstore(0, 0x1626ba7e)
                return(31, 1)
            }
        }
        if (_signatureMode == 4 && digest != _expectedDigest) return 0xffffffff;
        return 0x1626ba7e;
    }

    function register(
        ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability
    ) external {
        registry.registerAdoptionProfileV1(capability);
    }

    function revokeCurrentness(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bytes32 digest) external {
        registry.revokeExecutionCurrentnessV1(digest);
    }

    function revokeGrant(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bytes32 digest) external {
        registry.revokeLaunchGrantV1(digest);
    }

    function advanceEpochs(
        ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry,
        bytes32 securityControlHeadHash,
        uint64 securityEpoch,
        bytes32 securityEpochHash,
        uint64 policyEpoch,
        bytes32 policyEpochHash,
        uint64 reviewGeneration,
        bytes32 reviewGenerationHash
    ) external {
        registry.advanceSecurityPolicyEpochsV1(
            securityControlHeadHash,
            securityEpoch,
            securityEpochHash,
            policyEpoch,
            policyEpochHash,
            reviewGeneration,
            reviewGenerationHash
        );
    }

    function setProfileStatus(
        ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry,
        bytes32 profileKey,
        IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1 status
    ) external {
        registry.setAdoptionProfileStatusV1(profileKey, status);
    }

    function setGlobalKill(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bool killed) external {
        registry.setGlobalAdoptionKillV1(killed);
    }

    function advanceFinality(
        ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry,
        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 calldata receipt
    ) external {
        registry.advanceFinalityIndexingV1(receipt);
    }
}

contract CompatGraphNodeV1 {
    uint256 private immutable _marker;

    constructor(uint256 marker) {
        _marker = marker;
    }
}

contract CompatStateVerifierV1 is IProgrammableCompletedGraphAdoptionStateVerifierV1 {
    bytes32 private _architectureStateHash;
    bytes32 private _poolStateHash;
    bytes32 private _revenueStateHash;
    uint8 private _mode;

    function setStates(bytes32 architectureStateHash, bytes32 poolStateHash, bytes32 revenueStateHash) external {
        _architectureStateHash = architectureStateHash;
        _poolStateHash = poolStateHash;
        _revenueStateHash = revenueStateHash;
    }

    function setMode(uint8 mode) external {
        _mode = mode;
    }

    function verifyCurrentStateV1(
        address,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components,
        IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[] calldata edges,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionRequestV1 calldata
    ) external view returns (bytes32 architectureStateHash, bytes32 poolStateHash, bytes32 revenueStateHash) {
        if (components.length != 2 || edges.length != 1) revert("unexpected graph");
        if (_mode == 1) revert("compat verifier revert");
        if (_mode == 2) {
            assembly ("memory-safe") {
                return(0, 32)
            }
        }
        return (_architectureStateHash, _poolStateHash, _revenueStateHash);
    }
}

/// @dev Test-only proxy-shaped dependency. Registration must reject its actual DELEGATECALL opcode.
contract CompatDelegateProxyV1 {
    address private immutable _implementation;

    constructor(address implementation) {
        _implementation = implementation;
    }

    fallback() external payable {
        address implementation = _implementation;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let success := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch success
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

/// @notice Self-contained focused lifecycle/negative tests; no forge-std or legacy package imports are required.
contract ProgrammableCompletedGraphAdoptionCompatV1Test {
    VmCompatV1 private constant VM = VmCompatV1(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant SECURITY_HEAD = keccak256("compat-security-head-v1");
    bytes32 private constant SECURITY_EPOCH_HASH = keccak256("compat-security-epoch-v1");
    bytes32 private constant POLICY_EPOCH_HASH = keccak256("compat-policy-epoch-v1");
    bytes32 private constant REVIEW_GENERATION_HASH = keccak256("compat-review-generation-v1");
    bytes32 private constant DEPENDENCY_BEHAVIOR_EVIDENCE_HASH = keccak256("compat-dependency-behavior-evidence-v1");

    struct Fixture {
        ProgrammableCompletedGraphAdoptionCompatCodecV1 codec;
        ProgrammableCompletedGraphAdoptionValidatorV1 validator;
        ProgrammableCompletedGraphAdoptionPreflightV1 preflight;
        ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry;
        CompatAuthorityV1 reviewer;
        CompatAuthorityV1 governance;
        CompatAuthorityV1 finality;
        CompatAuthorityV1 indexer;
        CompatStateVerifierV1 stateVerifier;
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphAdoptionV1 adoption;
    }

    struct ControlSnapshotV1 {
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        uint64 reviewGeneration;
        bytes32 reviewGenerationHash;
    }

    function testAdoptConsumesEvergreenGrantAndAnchorsCanonicalReceipt() external {
        Fixture memory fixture = _fixture();
        bytes32 coreHash = fixture.registry.adoptCompletedGraphV1(fixture.adoption);
        bytes32 grantDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);
        bytes32 stampLaunchId = fixture.adoption.request.stampLaunchId;

        require(coreHash != bytes32(0), "empty core hash");
        require(
            _grantStatus(fixture.registry, grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Consumed,
            "grant not consumed"
        );
        require(
            _receiptStatus(fixture.registry, stampLaunchId)
                == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Adopted,
            "receipt not adopted"
        );
        IProgrammableCompletedGraphAdoptionCompatV1.CanonicalReceiptCoreV1 memory core =
            fixture.registry.canonicalReceiptCore(stampLaunchId);
        require(core.receiptCoreHash == coreHash, "receipt self hash mismatch");
        require(core.launchGrantDigest == grantDigest, "grant digest mismatch");
        require(
            core.launchGrantHash == fixture.codec.computeLaunchGrantHash(fixture.adoption.grant), "grant hash mismatch"
        );
        require(core.contractPlanHash == fixture.adoption.grant.contractPlanHash, "plan hash mismatch");
        require(core.sourceLaunchId == fixture.adoption.plan.sourceLaunchId, "source launch identity mismatch");
        require(core.stampLaunchId == stampLaunchId, "stamp launch identity mismatch");
        require(
            core.adoptionRequestHash == fixture.codec.computeAdoptionRequestHash(fixture.adoption.request),
            "request hash mismatch"
        );
        require(core.profileCapabilityHash != bytes32(0), "empty capability hash");
        require(
            core.receiptCoreHash == fixture.codec.computeCanonicalReceiptCoreHash(core), "canonical core hash mismatch"
        );
    }

    function testRevokedCurrentnessCannotConsumeActiveEvergreenGrant() external {
        Fixture memory fixture = _fixture();
        bytes32 currentnessDigest = fixture.registry.executionCurrentnessDigest(fixture.adoption.currentness);
        fixture.governance.revokeCurrentness(fixture.registry, currentnessDigest);

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "revoked currentness accepted");
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "failed adoption consumed grant"
        );
    }

    function testConsumedGrantAndCurrentnessCannotReplay() external {
        Fixture memory fixture = _fixture();
        fixture.registry.adoptCompletedGraphV1(fixture.adoption);

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "replay accepted");
    }

    function testRevokedGrantCannotConsumeEvenWithCurrentness() external {
        Fixture memory fixture = _fixture();
        bytes32 grantDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);
        fixture.governance.revokeGrant(fixture.registry, grantDigest);

        require(
            _grantStatus(fixture.registry, grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Revoked,
            "grant did not become revoked"
        );
        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "revoked grant accepted");
        require(
            _grantStatus(fixture.registry, grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Revoked,
            "failed adoption changed revoked grant"
        );
    }

    function testGrantHashAndDigestVectorRemainStable() external {
        Fixture memory fixture = _fixture();
        bytes32 grantHash = fixture.codec.computeLaunchGrantHash(fixture.adoption.grant);
        bytes32 grantDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantStateHeadV1 memory head =
            _grantStateHead(fixture.registry, grantDigest);
        require(grantHash != bytes32(0) && head.grantHash == grantHash, "grant hash drift");
        require(head.grantDigest == grantDigest, "grant digest drift");
        require(
            fixture.codec.computePlanHash(fixture.adoption.plan) == fixture.adoption.grant.contractPlanHash,
            "plan hash drift"
        );
    }

    function testTypedPreflightReadbackSeparatesRuntimeLifecycleVacancyAndIndexState() external {
        Fixture memory fixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query = _preflightQuery(fixture);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory readback =
            fixture.preflight.adoptionPreflightReadbackV1(address(fixture.registry), query, bytes32(0));
        bytes32 grantDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);

        require(readback.chainId == block.chainid && readback.registry == address(fixture.registry), "wrong domain");
        require(readback.liveRuntimeMask == 0x01ff, "runtime class not distinguishable");
        require(readback.runtimeAuthorityBindingHash != bytes32(0), "runtime binding absent");
        require(readback.dependencyBehaviorEvidenceHash == DEPENDENCY_BEHAVIOR_EVIDENCE_HASH, "behavior drift");
        require(
            readback.profileStatus == IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Active,
            "profile not active"
        );
        require(
            readback.grantStateHead.status == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active
                && readback.grantStateHead.grantDigest == grantDigest,
            "grant state mismatch"
        );
        require(
            readback.winnerNonceOccupantGrantDigest == grantDigest
                && readback.winnerKeyOccupantGrantDigest == grantDigest,
            "winner state mismatch"
        );
        require(
            readback.receiptStatus == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Prepared
                && readback.receiptCoreHash == bytes32(0) && readback.finalityIndexingReceiptHash == bytes32(0),
            "prepared receipt/index state mismatch"
        );
        require(
            readback.graphOccupantStampLaunchId == bytes32(0)
                && readback.exclusiveTokenOccupantStampLaunchId == bytes32(0)
                && readback.poolOccupantStampLaunchId == bytes32(0),
            "vacancy state mismatch"
        );
        require(
            !readback.currentnessNonceUsed && !readback.currentnessRevoked && !readback.currentnessUsed, "replay state"
        );
        require(readback.queryHash == fixture.codec.computeAdoptionPreflightQueryHash(query), "query hash mismatch");

        bytes32 baselineQueryHash = readback.queryHash;
        query.expectedContractPlanHash = keccak256("wrong-diagnostic-plan");
        require(
            fixture.codec.computeAdoptionPreflightQueryHash(query) != baselineQueryHash,
            "plan diagnostic omitted from query"
        );
        query = _preflightQuery(fixture);
        query.antiReplayNonce = keccak256("wrong-diagnostic-nonce");
        require(
            fixture.codec.computeAdoptionPreflightQueryHash(query) != baselineQueryHash,
            "winner nonce omitted from query"
        );
        query = _preflightQuery(fixture);
        query.stampLaunchId = keccak256("wrong-diagnostic-stamp");
        require(
            fixture.codec.computeAdoptionPreflightQueryHash(query) != baselineQueryHash, "stamp id omitted from query"
        );
    }

    function testPreflightProviderSimulationAndDeploymentEvidenceAreMandatoryTransportOnly() external {
        Fixture memory fixture = _fixture();
        bytes32 simulation = fixture.adoption.currentness.simulationEvidenceHash;
        bytes32 deployment = fixture.adoption.currentness.serviceDeploymentBindingHash;
        bytes32 providers = fixture.adoption.currentness.dualProviderQuorumEvidenceHash;

        fixture.adoption.currentness.simulationEvidenceHash = bytes32(0);
        require(!_adoptionSucceeds(fixture), "missing pre-sign simulation evidence accepted");
        fixture.adoption.currentness.simulationEvidenceHash = simulation;
        fixture.adoption.currentness.serviceDeploymentBindingHash = bytes32(0);
        require(!_adoptionSucceeds(fixture), "missing service deployment identity accepted");
        fixture.adoption.currentness.serviceDeploymentBindingHash = deployment;
        fixture.adoption.currentness.dualProviderQuorumEvidenceHash = bytes32(0);
        require(!_adoptionSucceeds(fixture), "missing dual-provider evidence accepted");
        fixture.adoption.currentness.dualProviderQuorumEvidenceHash = providers;
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "transport outage consumed durable grant"
        );
        fixture.registry.adoptCompletedGraphV1(fixture.adoption);
    }

    function testComponentRuntimeMutationChangesReadbackAndCannotConsumeGrant() external {
        Fixture memory fixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query = _preflightQuery(fixture);
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 memory component = fixture.adoption.components[0];
        query.component = component.account;
        query.componentScope = component.scope;
        query.expectedRuntimeCodeHash = component.runtimeCodeHash;
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory beforeMutation =
            fixture.preflight.adoptionPreflightReadbackV1(address(fixture.registry), query, bytes32(0));

        VM.etch(component.account, hex"60006000f3");
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory afterMutation =
            fixture.preflight.adoptionPreflightReadbackV1(address(fixture.registry), query, bytes32(0));
        require(afterMutation.actualComponentRuntimeCodeHash != component.runtimeCodeHash, "runtime mutation hidden");
        require(afterMutation.componentLeafHash != beforeMutation.componentLeafHash, "component leaf did not change");
        require(!_adoptionSucceeds(fixture), "mutated runtime consumed currentness-bound grant");
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "runtime failure consumed durable grant"
        );
    }

    function testCandidateDigestReplayDiagnosticsAreExcludedFromTheSignedSnapshot() external {
        Fixture memory fixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query = _preflightQuery(fixture);
        bytes32 candidateDigest = keccak256("diagnostic-currentness-digest");
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory baseline =
            fixture.preflight.adoptionPreflightReadbackV1(address(fixture.registry), query, bytes32(0));
        fixture.governance.revokeCurrentness(fixture.registry, candidateDigest);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory diagnostic =
            fixture.preflight.adoptionPreflightReadbackV1(address(fixture.registry), query, candidateDigest);

        require(diagnostic.currentnessRevoked && !diagnostic.currentnessUsed, "diagnostic state missing");
        require(diagnostic.queryHash == baseline.queryHash, "candidate digest entered query");
        require(
            diagnostic.globalReadbackHeadHash == baseline.globalReadbackHeadHash, "diagnostic entered signed snapshot"
        );
    }

    function testSourceStampAndAntiReplayIdentitiesAreExplicitlySeparated() external {
        Fixture memory fixture = _fixture();
        bytes32 planHash = fixture.codec.computePlanHash(fixture.adoption.plan);
        bytes32 sourceLaunchId = fixture.adoption.plan.sourceLaunchId;
        bytes32 stampLaunchId = fixture.adoption.request.stampLaunchId;
        bytes32 antiReplayNonce = fixture.adoption.grant.antiReplayNonce;

        require(sourceLaunchId != stampLaunchId, "source id equated to stamp id");
        require(sourceLaunchId != antiReplayNonce, "source id equated to replay nonce");
        require(stampLaunchId != antiReplayNonce, "stamp id equated to replay nonce");
        require(
            stampLaunchId
                == fixture.codec
                    .computeStampLaunchId(
                        address(fixture.registry),
                        fixture.adoption.plan.launchWallet,
                        fixture.adoption.plan.profileKey,
                        planHash,
                        sourceLaunchId
                    ),
            "stamp id formula mismatch"
        );

        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory nonceOnly = _cloneGrant(fixture.adoption.grant);
        nonceOnly.antiReplayNonce = keccak256("compat-independent-replay-nonce");
        require(
            fixture.codec.computeWinnerKeyHash(nonceOnly) == fixture.adoption.grant.winnerKeyHash,
            "anti-replay nonce entered winner identity"
        );
        require(
            fixture.registry.launchGrantDigest(nonceOnly) != fixture.registry.launchGrantDigest(fixture.adoption.grant),
            "anti-replay nonce absent from grant digest"
        );

        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 memory newSourcePlan = fixture.adoption.plan;
        newSourcePlan.sourceLaunchId = keccak256("compat-distinct-source-launch-id");
        bytes32 newPlanHash = fixture.codec.computePlanHash(newSourcePlan);
        bytes32 newStampLaunchId = fixture.codec
            .computeStampLaunchId(
                address(fixture.registry),
                newSourcePlan.launchWallet,
                newSourcePlan.profileKey,
                newPlanHash,
                newSourcePlan.sourceLaunchId
            );
        require(newPlanHash != planHash, "source id absent from plan hash");
        require(newStampLaunchId != stampLaunchId, "source id absent from stamp formula");

        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory newSourceGrant =
            _cloneGrant(fixture.adoption.grant);
        newSourceGrant.sourceLaunchId = newSourcePlan.sourceLaunchId;
        newSourceGrant.contractPlanHash = newPlanHash;
        require(
            fixture.codec.computeWinnerKeyHash(newSourceGrant) != fixture.adoption.grant.winnerKeyHash,
            "source id absent from winner identity"
        );

        Fixture memory sourceNonceCollision = _fixtureWithoutGrantActivation();
        sourceNonceCollision.adoption.grant.antiReplayNonce = sourceNonceCollision.adoption.plan.sourceLaunchId;
        (bool sourceNonceAccepted,) = address(sourceNonceCollision.registry)
            .call(
                abi.encodeCall(
                    sourceNonceCollision.registry.activateLaunchGrantV1, (sourceNonceCollision.adoption.grant, hex"01")
                )
            );
        require(!sourceNonceAccepted, "source id accepted as anti-replay nonce");

        Fixture memory stampNonceCollision = _fixtureWithoutGrantActivation();
        stampNonceCollision.adoption.grant.antiReplayNonce = stampNonceCollision.adoption.request.stampLaunchId;
        (bool stampNonceAccepted,) = address(stampNonceCollision.registry)
            .call(
                abi.encodeCall(
                    stampNonceCollision.registry.activateLaunchGrantV1, (stampNonceCollision.adoption.grant, hex"01")
                )
            );
        require(!stampNonceAccepted, "stamp id accepted as anti-replay nonce");
    }

    function testGitObjectCommitmentsAreDomainSeparatedAndRejectRawPadding() external {
        Fixture memory fixture = _fixture();
        bytes20 objectId = hex"1111111111111111111111111111111111111111";
        bytes32 commitHash = fixture.codec.computeSourceCommitHash(objectId);
        bytes32 treeHash = fixture.codec.computeSourceTreeHash(objectId);

        require(commitHash != treeHash, "commit and tree domains collided");
        require(commitHash != bytes32(objectId), "raw padded commit id accepted as commitment");
        require(treeHash != bytes32(objectId), "raw padded tree id accepted as commitment");
        require(
            fixture.adoption.grant.sourceCommitHash
                == fixture.codec.computeSourceCommitHash(fixture.adoption.plan.sourceCommitId),
            "plan commit helper mismatch"
        );
        require(
            fixture.adoption.grant.sourceTreeHash
                == fixture.codec.computeSourceTreeHash(fixture.adoption.plan.sourceTreeId),
            "plan tree helper mismatch"
        );

        (bool zeroCommitAccepted,) =
            address(fixture.codec).call(abi.encodeCall(fixture.codec.computeSourceCommitHash, (bytes20(0))));
        (bool zeroTreeAccepted,) =
            address(fixture.codec).call(abi.encodeCall(fixture.codec.computeSourceTreeHash, (bytes20(0))));
        require(!zeroCommitAccepted && !zeroTreeAccepted, "zero Git object id accepted");
    }

    function testRequestExecutableSourceAndCarrierIdentitiesRemainDistinct() external {
        Fixture memory fixture = _fixture();
        bytes32 canonicalGrantHash = fixture.codec.computeLaunchGrantHash(fixture.adoption.grant);

        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory changedRequestReview =
            _cloneGrant(fixture.adoption.grant);
        changedRequestReview.applicantIdHash = keccak256("distinct-applicant-request-identity");
        changedRequestReview.reviewerAttestationHash = keccak256("distinct-review-admission-and-request-receipt");
        bytes32 requestBoundGrantHash = fixture.codec.computeLaunchGrantHash(changedRequestReview);

        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory changedCarrier =
            _cloneGrant(fixture.adoption.grant);
        changedCarrier.builderEvidenceHash = keccak256("distinct-offchain-carrier-provenance");
        bytes32 carrierBoundGrantHash = fixture.codec.computeLaunchGrantHash(changedCarrier);

        require(requestBoundGrantHash != canonicalGrantHash, "request/review identity not grant-bound");
        require(carrierBoundGrantHash != canonicalGrantHash, "carrier provenance not grant-bound");
        require(requestBoundGrantHash != carrierBoundGrantHash, "request and carrier identity collapsed");
        require(
            changedRequestReview.sourceCommitHash == fixture.adoption.grant.sourceCommitHash
                && changedRequestReview.sourceTreeHash == fixture.adoption.grant.sourceTreeHash
                && changedCarrier.sourceCommitHash == fixture.adoption.grant.sourceCommitHash
                && changedCarrier.sourceTreeHash == fixture.adoption.grant.sourceTreeHash,
            "executable source identity was implicitly substituted"
        );
    }

    function testRawPaddedGitObjectIdsCannotReachAdoption() external {
        Fixture memory rawCommit = _fixtureWithoutGrantActivation();
        rawCommit.adoption.grant.sourceCommitHash = bytes32(rawCommit.adoption.plan.sourceCommitId);
        rawCommit.adoption.grant.winnerKeyHash = rawCommit.codec.computeWinnerKeyHash(rawCommit.adoption.grant);
        rawCommit.registry.activateLaunchGrantV1(rawCommit.adoption.grant, hex"01");
        require(!_adoptionSucceeds(rawCommit), "raw padded commit id reached adoption");
        require(
            _grantStatus(rawCommit.registry, rawCommit.registry.launchGrantDigest(rawCommit.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "raw commit rejection consumed grant"
        );

        Fixture memory rawTree = _fixtureWithoutGrantActivation();
        rawTree.adoption.grant.sourceTreeHash = bytes32(rawTree.adoption.plan.sourceTreeId);
        rawTree.adoption.grant.winnerKeyHash = rawTree.codec.computeWinnerKeyHash(rawTree.adoption.grant);
        rawTree.registry.activateLaunchGrantV1(rawTree.adoption.grant, hex"01");
        require(!_adoptionSucceeds(rawTree), "raw padded tree id reached adoption");
        require(
            _grantStatus(rawTree.registry, rawTree.registry.launchGrantDigest(rawTree.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "raw tree rejection consumed grant"
        );
    }

    function testYearsLaterFreshCurrentnessConsumesTheSameActiveGrant() external {
        Fixture memory fixture = _fixture();
        VM.warp(block.timestamp + 730 days);
        fixture.adoption.currentness.nonce = keccak256("compat-years-later-currentness-nonce");
        fixture.adoption.currentness.validAfter = uint64(block.timestamp);
        fixture.adoption.currentness.deadline = uint64(block.timestamp + 1 hours);
        _bindPreflightCurrentness(fixture);

        fixture.registry.adoptCompletedGraphV1(fixture.adoption);
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Consumed,
            "evergreen grant stranded"
        );
    }

    function testEpochAdvanceRequiresGrantRereviewAndRebind() external {
        Fixture memory fixture = _fixture();
        fixture.governance
            .advanceEpochs(
                fixture.registry,
                keccak256("compat-security-head-v2"),
                2,
                keccak256("compat-security-epoch-v2"),
                2,
                keccak256("compat-policy-epoch-v2"),
                2,
                keccak256("compat-review-generation-v2")
            );

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "stale currentness accepted after epoch advance");
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "epoch block revoked evergreen grant"
        );
    }

    function testFreshCurrentnessAtNewEpochCannotConsumeOldGrant() external {
        Fixture memory fixture = _fixture();
        bytes32 newHead = keccak256("compat-security-head-v2");
        bytes32 newSecurityEpochHash = keccak256("compat-security-epoch-v2");
        bytes32 newPolicyEpochHash = keccak256("compat-policy-epoch-v2");
        fixture.governance
            .advanceEpochs(
                fixture.registry,
                newHead,
                2,
                newSecurityEpochHash,
                2,
                newPolicyEpochHash,
                2,
                keccak256("compat-review-generation-v2")
            );
        fixture.adoption.currentness.securityControlHeadHash = newHead;
        fixture.adoption.currentness.securityEpoch = 2;
        fixture.adoption.currentness.securityEpochHash = newSecurityEpochHash;
        fixture.adoption.currentness.policyEpoch = 2;
        fixture.adoption.currentness.policyEpochHash = newPolicyEpochHash;
        fixture.adoption.currentness.nonce = keccak256("compat-fresh-currentness-after-epoch");

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "fresh currentness bypassed stale grant review");
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "failed rebind check consumed grant"
        );
    }

    function testGlobalKillBlocksActivationAndConsumptionUntilEpochRebind() external {
        Fixture memory fixture = _fixture();
        fixture.governance.setGlobalKill(fixture.registry, true);
        require(_globalKilled(fixture.registry), "global kill not recorded");
        require(!_adoptionSucceeds(fixture), "global kill allowed consumption");

        (bool activationSucceeded,) = address(fixture.registry)
            .call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (fixture.adoption.grant, hex"01")));
        require(!activationSucceeded, "global kill allowed activation");

        fixture.governance
            .advanceEpochs(
                fixture.registry,
                keccak256("compat-security-head-after-kill"),
                2,
                keccak256("compat-security-epoch-after-kill"),
                2,
                keccak256("compat-policy-epoch-after-kill"),
                2,
                keccak256("compat-review-generation-after-kill")
            );
        fixture.governance.setGlobalKill(fixture.registry, false);
        require(!_globalKilled(fixture.registry), "global kill did not clear after epoch advance");
        require(!_adoptionSucceeds(fixture), "pre-incident grant revived after kill clear");
    }

    function testSuspendedAndDeprecatedProfileBlockConsumptionAndRegistration() external {
        Fixture memory fixture = _fixture();
        bytes32 profileKey = fixture.adoption.plan.profileKey;
        fixture.governance
            .setProfileStatus(
                fixture.registry, profileKey, IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Suspended
            );
        require(
            _profileStatus(fixture.registry, profileKey)
                == IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Suspended,
            "profile not suspended"
        );
        require(!_adoptionSucceeds(fixture), "suspended profile consumed grant");
        (bool activationSucceeded,) = address(fixture.registry)
            .call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (fixture.adoption.grant, hex"01")));
        require(!activationSucceeded, "suspended profile allowed activation");

        (bool reactivationSucceeded,) = address(fixture.governance)
            .call(
                abi.encodeCall(
                    fixture.governance.setProfileStatus,
                    (fixture.registry, profileKey, IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Active)
                )
            );
        require(!reactivationSucceeded, "suspended profile reactivated without a new review binding");
        require(
            _profileStatus(fixture.registry, profileKey)
                == IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Suspended,
            "failed reactivation changed suspended profile"
        );
        require(!_adoptionSucceeds(fixture), "pre-suspension grant/currentness revived");

        fixture.governance
            .setProfileStatus(
                fixture.registry, profileKey, IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Deprecated
            );
        require(
            _profileStatus(fixture.registry, profileKey)
                == IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Deprecated,
            "profile not deprecated"
        );
        require(!_adoptionSucceeds(fixture), "deprecated profile consumed grant");
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability = _capability(fixture);
        (bool registrationSucceeded,) = address(fixture.governance)
            .call(abi.encodeCall(fixture.governance.register, (fixture.registry, capability)));
        require(!registrationSucceeded, "deprecated profile was re-registered");
    }

    function testVerifierStateMutationAfterReviewBlocksAtomicConsumption() external {
        Fixture memory fixture = _fixture();
        fixture.stateVerifier.setStates(keccak256("mutated-architecture-state"), bytes32(0), bytes32(0));
        require(!_adoptionSucceeds(fixture), "mutated current state accepted");
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "failed verifier check consumed grant"
        );
    }

    function testVerifierRevertAndMalformedReturnAreFailClosed() external {
        Fixture memory revertingFixture = _fixture();
        revertingFixture.stateVerifier.setMode(1);
        require(!_adoptionSucceeds(revertingFixture), "reverting verifier accepted");

        Fixture memory malformedFixture = _fixture();
        malformedFixture.stateVerifier.setMode(2);
        require(!_adoptionSucceeds(malformedFixture), "malformed verifier return accepted");
    }

    function testCreateNonceZeroEvidenceIsAcceptedWhenTypedProvenanceMatches() external {
        Fixture memory fixture = _fixture();
        address deployer = 0x0000000000000000000000000000000000001234;
        address created = _createAddressAtNonceZero(deployer);
        bytes memory runtime = fixture.adoption.components[0].account.code;
        VM.etch(created, runtime);

        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 memory component = fixture.adoption.components[0];
        component.account = created;
        component.deploymentKind = IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.Create;
        component.deployer = deployer;
        component.createNonce = 0;
        component.create2Salt = bytes32(0);
        component.initCodeHash = keccak256("compat-create-nonce-zero-initcode");
        component.externalCanonicalIdHash = bytes32(0);
        component.runtimeCodeHash = created.codehash;
        component.creationReceiptEvidence = IProgrammableCompletedGraphAdoptionCompatV1.CreationReceiptEvidenceV1({
            transactionHash: keccak256("compat-create-nonce-zero-tx"),
            blockNumber: 1,
            blockHash: keccak256("compat-create-nonce-zero-block"),
            transactionIndex: 0,
            transactionSender: deployer,
            transactionSenderNonce: 0,
            transactionTo: address(0),
            transactionValueWei: 0,
            transactionInputHash: component.initCodeHash,
            receiptSucceeded: true,
            topLevelCreatedAddress: created,
            internalCreationTraceHash: bytes32(0),
            finalityEvidenceHash: keccak256("compat-create-nonce-zero-finality"),
            dualProviderEvidenceHash: keccak256("compat-create-nonce-zero-dual-provider")
        });
        fixture.adoption.components[0] = component;
        _sortTwoComponents(fixture.adoption.components);
        _refreshPlanCommitments(fixture);

        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability = _capability(fixture);
        fixture.validator
            .validateCompletedGraphV1(
                address(fixture.registry),
                capability,
                fixture.adoption.plan,
                fixture.adoption.grant.sourceCommitHash,
                fixture.adoption.grant.sourceTreeHash,
                fixture.adoption.components,
                fixture.adoption.edges,
                fixture.adoption.request
            );
    }

    function testConstructorNestedCreate2ReceiptContextAndTraceAreExact() external {
        Fixture memory fixture = _fixture();
        address create2Deployer = 0x0000000000000000000000000000000000002345;
        bytes32 salt = keccak256("compat-constructor-nested-create2-salt");
        bytes32 initCodeHash = keccak256("compat-constructor-nested-create2-initcode");
        address created = _create2Address(create2Deployer, salt, initCodeHash);
        bytes memory runtime = fixture.adoption.components[0].account.code;
        VM.etch(created, runtime);

        address transactionSender = 0x0000000000000000000000000000000000003456;
        uint64 transactionSenderNonce = 7;
        address topLevelCreatedAddress = _createAddress(transactionSender, transactionSenderNonce);
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 memory component = fixture.adoption.components[0];
        component.account = created;
        component.deploymentKind = IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.Create2;
        component.deployer = create2Deployer;
        component.createNonce = 0;
        component.create2Salt = salt;
        component.initCodeHash = initCodeHash;
        component.externalCanonicalIdHash = bytes32(0);
        component.runtimeCodeHash = created.codehash;
        component.creationReceiptEvidence = IProgrammableCompletedGraphAdoptionCompatV1.CreationReceiptEvidenceV1({
            transactionHash: keccak256("compat-constructor-nested-create2-tx"),
            blockNumber: 2,
            blockHash: keccak256("compat-constructor-nested-create2-block"),
            transactionIndex: 1,
            transactionSender: transactionSender,
            transactionSenderNonce: transactionSenderNonce,
            transactionTo: address(0),
            transactionValueWei: 0,
            transactionInputHash: keccak256("compat-outer-launcher-initcode"),
            receiptSucceeded: true,
            topLevelCreatedAddress: topLevelCreatedAddress,
            internalCreationTraceHash: keccak256("compat-create2-internal-trace"),
            finalityEvidenceHash: keccak256("compat-create2-finality"),
            dualProviderEvidenceHash: keccak256("compat-create2-dual-provider")
        });
        fixture.adoption.components[0] = component;
        _sortTwoComponents(fixture.adoption.components);
        _refreshPlanCommitments(fixture);

        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability = _capability(fixture);
        require(_validationSucceeds(fixture, capability), "constructor-nested CREATE2 receipt rejected");

        uint256 createdIndex = fixture.adoption.components[0].account == created ? 0 : 1;
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 memory validComponent =
            fixture.adoption.components[createdIndex];
        fixture.adoption.components[createdIndex].creationReceiptEvidence.topLevelCreatedAddress = address(0xdead);
        _refreshPlanCommitments(fixture);
        require(!_validationSucceeds(fixture, capability), "wrong outer-created address accepted");

        fixture.adoption.components[createdIndex] = validComponent;
        fixture.adoption.components[createdIndex].deployer = address(0xbeef);
        _refreshPlanCommitments(fixture);
        require(!_validationSucceeds(fixture, capability), "wrong CREATE2 deployer accepted");

        fixture.adoption.components[createdIndex] = validComponent;
        fixture.adoption.components[createdIndex].creationReceiptEvidence.internalCreationTraceHash = bytes32(0);
        _refreshPlanCommitments(fixture);
        require(!_validationSucceeds(fixture, capability), "missing CREATE2 trace accepted");
    }

    function testOptionalPoolPlanStillRequiresCanonicalPoolManagerBinding() external {
        Fixture memory fixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability = _capability(fixture);
        address manager = fixture.adoption.components[1].account;
        fixture.adoption.plan.identityMask |= 1 << 4;
        fixture.adoption.plan.poolManager = manager;
        fixture.adoption.plan.poolManagerRuntimeCodeHash = manager.codehash;
        fixture.adoption.plan.poolManagerComponentIndex = 1;
        fixture.adoption.plan.poolId = keccak256("compat-pool-id");
        fixture.adoption.plan.poolKeyHash = keccak256("compat-pool-key");
        fixture.adoption.plan.poolResultHash = keccak256("compat-pool-result");
        fixture.adoption.request.currentPoolStateHash = keccak256("compat-current-pool-state");
        fixture.stateVerifier
            .setStates(
                fixture.adoption.request.currentArchitectureStateHash,
                fixture.adoption.request.currentPoolStateHash,
                bytes32(0)
            );
        _refreshPlanCommitments(fixture);

        require(!_validationSucceeds(fixture, capability), "optional pool accepted without canonical manager");
        capability.canonicalPoolManagerChainId = block.chainid;
        capability.canonicalPoolManager = manager;
        capability.canonicalPoolManagerRuntimeCodeHash = manager.codehash;
        require(_validationSucceeds(fixture, capability), "canonical optional pool binding rejected");
    }

    function testErc1271WrongMagicRevertAndShortReturnAreFailClosed() external {
        _assertAuthorityModeRejects(1, false);
        _assertAuthorityModeRejects(2, false);
        _assertAuthorityModeRejects(3, false);
    }

    function testErc1271DigestMutationIsRejected() external {
        _assertAuthorityModeRejects(4, true);
    }

    function testGrantExecutionConstraintMustExactlyMatchTheRegisteredAdoptCapability() external {
        Fixture memory fixture = _fixture();
        fixture.adoption.grant.executionTimeConstraint =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.ExternalExecutionTimeBound;
        fixture.adoption.grant.executionTimeConstraintEvidenceHash = keccak256("source-execution-window-evidence");
        fixture.adoption.grant.antiReplayNonce = keccak256("compat-external-time-bound-nonce");

        (bool success,) = address(fixture.registry)
            .call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (fixture.adoption.grant, hex"01")));
        require(!success, "grant constraint bypassed registered ADOPT capability");
    }

    function testDenyCapabilityAndProxyShapedVerifierCannotBeRegistered() external {
        Fixture memory fixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory denied = _capability(fixture);
        denied.profileDescriptorHash = keccak256("compat-deny-profile-descriptor");
        denied.routeSchemaHash = keccak256("compat-deny-route-schema");
        denied.profileKey = fixture.codec.computeProfileKey(denied.profileDescriptorHash, denied.routeSchemaHash);
        denied.admissionStatus =
        IProgrammableCompletedGraphAdoptionCompatV1.AdmissionStatusV1.DenyPendingReviewAndDeploymentEvidence;
        (bool deniedRegistrationSucceeded,) =
            address(fixture.governance).call(abi.encodeCall(fixture.governance.register, (fixture.registry, denied)));
        require(!deniedRegistrationSucceeded, "DENY capability was registered");

        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory proxyBound = _capability(fixture);
        proxyBound.profileDescriptorHash = keccak256("compat-proxy-profile-descriptor");
        proxyBound.routeSchemaHash = keccak256("compat-proxy-route-schema");
        proxyBound.profileKey =
            fixture.codec.computeProfileKey(proxyBound.profileDescriptorHash, proxyBound.routeSchemaHash);
        CompatDelegateProxyV1 proxy = new CompatDelegateProxyV1(address(fixture.stateVerifier));
        proxyBound.stateVerifierBinding.stateVerifier = address(proxy);
        proxyBound.stateVerifierBinding.stateVerifierRuntimeCodeHash = address(proxy).codehash;
        (bool proxyRegistrationSucceeded,) = address(fixture.governance)
            .call(abi.encodeCall(fixture.governance.register, (fixture.registry, proxyBound)));
        require(!proxyRegistrationSucceeded, "delegatecall-shaped verifier was registered");
    }

    function testLegacyCustomGraphRouteCannotBeSilentlyReinterpreted() external {
        Fixture memory fixture = _fixture();
        fixture.adoption.plan.routeSchemaHash = keccak256("custom-graph@1.0.0");

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "legacy route silently adopted");
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "failed legacy migration consumed grant"
        );
    }

    function testReviewGenerationIsExactForCapabilityGrantAndCurrentness() external {
        Fixture memory currentnessFixture = _fixture();
        currentnessFixture.adoption.currentness.reviewControl.reviewGeneration = 2;
        require(!_adoptionSucceeds(currentnessFixture), "future currentness review generation accepted");
        require(
            _grantStatus(
                currentnessFixture.registry,
                currentnessFixture.registry.launchGrantDigest(currentnessFixture.adoption.grant)
            ) == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "review-generation failure consumed grant"
        );

        Fixture memory grantFixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory futureGrant = grantFixture.adoption.grant;
        futureGrant.reviewControl.reviewGeneration = 2;
        futureGrant.reviewControl.reviewGenerationHash = keccak256("compat-review-generation-v2");
        futureGrant.antiReplayNonce = keccak256("compat-future-review-generation-nonce");
        futureGrant.winnerKeyHash = grantFixture.codec.computeWinnerKeyHash(futureGrant);
        (bool grantSucceeded,) = address(grantFixture.registry)
            .call(abi.encodeCall(grantFixture.registry.activateLaunchGrantV1, (futureGrant, hex"01")));
        require(!grantSucceeded, "future grant review generation accepted");

        Fixture memory capabilityFixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory futureCapability =
            _capability(capabilityFixture);
        futureCapability.profileDescriptorHash = keccak256("compat-future-generation-profile");
        futureCapability.routeSchemaHash = keccak256("compat-future-generation-route");
        futureCapability.profileKey = capabilityFixture.codec
            .computeProfileKey(futureCapability.profileDescriptorHash, futureCapability.routeSchemaHash);
        futureCapability.reviewControl.reviewGeneration = 2;
        futureCapability.reviewControl.reviewGenerationHash = keccak256("compat-review-generation-v2");
        (bool capabilitySucceeded,) = address(capabilityFixture.governance)
            .call(abi.encodeCall(capabilityFixture.governance.register, (capabilityFixture.registry, futureCapability)));
        require(!capabilitySucceeded, "future capability review generation accepted");
    }

    function testReviewRebindRequiresFreshWinnerAndKeepsOldGrantTerminal() external {
        Fixture memory fixture = _fixture();
        bytes32 oldDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);
        bytes32 oldWinnerKey = fixture.adoption.grant.winnerKeyHash;
        bytes32 oldWinnerNonce = fixture.adoption.grant.antiReplayNonce;
        fixture.governance.revokeGrant(fixture.registry, oldDigest);
        fixture.governance
            .advanceEpochs(
                fixture.registry,
                keccak256("compat-security-head-v2"),
                2,
                keccak256("compat-security-epoch-v2"),
                2,
                keccak256("compat-policy-epoch-v2"),
                2,
                keccak256("compat-review-generation-v2")
            );

        fixture.adoption.plan.profileDescriptorHash = keccak256("compat-profile-descriptor-v2");
        fixture.adoption.plan.routeSchemaHash = keccak256("compat-route-schema-v2");
        fixture.adoption.plan.profileKey = fixture.codec
            .computeProfileKey(fixture.adoption.plan.profileDescriptorHash, fixture.adoption.plan.routeSchemaHash);
        fixture.adoption.plan.exactContractBindingHash = keccak256("compat-contract-binding-v2");
        fixture.adoption.plan.planSchemaArtifactHash = keccak256("compat-plan-schema-v2");
        fixture.adoption.plan.sourceCommitId = hex"3333333333333333333333333333333333333333";
        fixture.adoption.plan.sourceTreeId = hex"4444444444444444444444444444444444444444";
        fixture.adoption.plan.manifestHash = keccak256("compat-manifest-v2");
        fixture.adoption.plan.policyHash = keccak256("compat-policy-v2");
        fixture.adoption.plan.compilerArtifactHash = keccak256("compat-compiler-artifact-v2");
        fixture.adoption.plan.applicantPlanArtifactHash = keccak256("compat-applicant-plan-v2");
        fixture.adoption.plan.adoptionIntentHash = keccak256("compat-adoption-intent-v2");
        fixture.adoption.edges[0].relationHash = keccak256("compat-edge-v2");
        _refreshPlanCommitments(fixture);

        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory successorCapability =
            _capability(fixture);
        fixture.governance.register(fixture.registry, successorCapability);
        _buildGrantRequestAndCurrentness(fixture, keccak256("compat-reviewed-successor-v2"));
        fixture.stateVerifier
            .setStates(
                fixture.adoption.request.currentArchitectureStateHash,
                fixture.adoption.request.currentPoolStateHash,
                fixture.adoption.request.currentRevenueStateHash
            );

        bytes32 newWinnerKey = fixture.adoption.grant.winnerKeyHash;
        require(newWinnerKey != oldWinnerKey, "review rebind reused old winner key");
        require(fixture.adoption.grant.antiReplayNonce != oldWinnerNonce, "review rebind reused old nonce");
        require(
            _grantStatus(fixture.registry, oldDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Revoked,
            "old grant left terminal revoked state"
        );

        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory reusedNonce =
            _cloneGrant(fixture.adoption.grant);
        reusedNonce.antiReplayNonce = oldWinnerNonce;
        (bool reusedNonceSucceeded,) = address(fixture.registry)
            .call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (reusedNonce, hex"01")));
        require(!reusedNonceSucceeded, "terminal old winner nonce reused");

        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory reusedKey = _cloneGrant(fixture.adoption.grant);
        reusedKey.winnerKeyHash = oldWinnerKey;
        (bool reusedKeySucceeded,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (reusedKey, hex"01")));
        require(!reusedKeySucceeded, "terminal old winner key reused");

        fixture.registry.activateLaunchGrantV1(fixture.adoption.grant, hex"01");
        _bindPreflightCurrentness(fixture);
        fixture.registry.adoptCompletedGraphV1(fixture.adoption);
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Consumed,
            "fresh reviewed successor did not consume"
        );
    }

    function testWinnerKeyDomainBindsEveryRequiredAxis() external {
        Fixture memory fixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory baseline = fixture.adoption.grant;
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory mutated = _cloneGrant(baseline);
        bytes32 baselineKey = fixture.codec.computeWinnerKeyHash(baseline);

        mutated.chainId += 1;
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.registry = address(0x1111);
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.launchWallet = address(0x2222);
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.applicantIdHash = keccak256("axis-applicant");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.profileKey = keccak256("axis-profile-key");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.profileDescriptorHash = keccak256("axis-profile-descriptor");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.exactContractBindingHash = keccak256("axis-contract-binding");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.sourceRepositoryHash = keccak256("axis-source-repository");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.sourceCommitHash = keccak256("axis-source-commit");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.sourceTreeHash = keccak256("axis-source-tree");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.sourceLaunchId = keccak256("axis-source-launch-id");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.contractPlanHash = keccak256("axis-contract-plan");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.applicantPlanArtifactHash = keccak256("axis-plan-artifact");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.componentGraphHash = keccak256("axis-component-graph");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.adoptionIntentHash = keccak256("axis-adoption-intent");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.securityEpoch += 1;
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.securityEpochHash = keccak256("axis-security-epoch-hash");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.policyEpoch += 1;
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.policyEpochHash = keccak256("axis-policy-epoch-hash");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.reviewControl.reviewGeneration += 1;
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
        mutated = _cloneGrant(baseline);
        mutated.reviewControl.reviewGenerationHash = keccak256("axis-review-generation-hash");
        _requireWinnerKeyChanged(fixture, baselineKey, mutated);
    }

    function testWinnerKeyReservationRejectsConcurrentIdenticalDomain() external {
        Fixture memory fixture = _fixture();
        bytes32 incumbentDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory competing = _cloneGrant(fixture.adoption.grant);
        competing.antiReplayNonce = keccak256("compat-competing-winner-nonce");

        require(
            fixture.codec.computeWinnerKeyHash(competing) == fixture.adoption.grant.winnerKeyHash,
            "identical domain changed winner key"
        );

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (competing, hex"01")));
        require(!success, "winner key allowed competing grant");
        require(
            _grantStatus(fixture.registry, incumbentDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "competing activation disturbed incumbent grant"
        );
    }

    function testFuzzWinnerKeyHasExactlyOneActiveGrant(bytes32 competingNonce) external {
        Fixture memory fixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory competing = _cloneGrant(fixture.adoption.grant);
        competing.antiReplayNonce = competingNonce;

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (competing, hex"01")));
        require(!success, "second grant won an occupied winner key");
    }

    function testSharedComponentIdentityRejectsCrossPlanProvenanceDrift() external {
        Fixture memory fixture =
            _fixtureWithScope(IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.SharedInfrastructure);
        fixture.registry.adoptCompletedGraphV1(fixture.adoption);

        fixture.adoption.components[1].externalCanonicalIdHash = keccak256("compat-drifted-external-canonical-id");
        _rebindAsDistinctReviewedPlan(fixture, keccak256("compat-shared-identity-drift-winner"));

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "shared account accepted changed canonical provenance");
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "shared identity collision consumed successor grant"
        );
    }

    function testFinalityAndIndexingOnlyAppendToTheImmutableReceiptCore() external {
        Fixture memory fixture = _fixture();
        bytes32 coreHash = fixture.registry.adoptCompletedGraphV1(fixture.adoption);
        bytes32 stampLaunchId = fixture.adoption.request.stampLaunchId;
        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory finalityReceipt = _finalityReceipt(
            fixture,
            stampLaunchId,
            coreHash,
            IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Finalized,
            bytes32(0),
            keccak256("compat-finality-evidence")
        );
        fixture.finality.advanceFinality(fixture.registry, finalityReceipt);
        require(
            _receiptStatus(fixture.registry, stampLaunchId)
                == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Finalized,
            "receipt did not finalize"
        );

        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory indexingReceipt = _finalityReceipt(
            fixture,
            stampLaunchId,
            coreHash,
            IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Indexed,
            finalityReceipt.finalityIndexingReceiptHash,
            keccak256("compat-indexing-evidence")
        );
        fixture.indexer.advanceFinality(fixture.registry, indexingReceipt);
        require(
            _receiptStatus(fixture.registry, stampLaunchId)
                == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Indexed,
            "receipt did not index"
        );

        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory publishedReceipt = _finalityReceipt(
            fixture,
            stampLaunchId,
            coreHash,
            IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Published,
            indexingReceipt.finalityIndexingReceiptHash,
            keccak256("compat-publication-evidence")
        );
        fixture.indexer.advanceFinality(fixture.registry, publishedReceipt);
        require(
            _receiptStatus(fixture.registry, stampLaunchId)
                == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Published,
            "receipt did not publish"
        );
        require(
            fixture.registry.canonicalReceiptCore(stampLaunchId).receiptCoreHash == coreHash,
            "append rewrote receipt core"
        );
    }

    function testPublishedTypehashesMatchTheCanonicalFormulaStrings() external {
        Fixture memory fixture = _fixture();
        require(
            fixture.codec.ADOPTION_ONLY_READINESS_CONSTRAINT_HASH()
                == keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_ONLY_NO_SOURCE_EXECUTION_V1"),
            "readiness typehash drift"
        );
        require(
            fixture.codec.SOURCE_COMMIT_TYPEHASH()
                == keccak256("ProgrammableCompletedGraphSourceCommitV1(bytes20 gitObjectId)"),
            "source commit typehash drift"
        );
        require(
            fixture.codec.SOURCE_TREE_TYPEHASH()
                == keccak256("ProgrammableCompletedGraphSourceTreeV1(bytes20 gitObjectId)"),
            "source tree typehash drift"
        );
        require(
            fixture.codec.LAUNCH_GRANT_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphLaunchGrantV1(bytes32 bindingAHash,bytes32 bindingBHash,bytes32 reviewHash)"
                ),
            "grant typehash drift"
        );
        require(
            fixture.codec.LAUNCH_GRANT_REVIEW_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphLaunchGrantReviewV1(bytes32 builderEvidenceHash,bytes32 reviewerAttestationHash,bytes32 securityControlHeadHash,bytes32 securityEpochHash,bytes32 policyHash,bytes32 policyEpochHash,bytes32 reviewGenerationHash,uint64 securityEpoch,uint64 policyEpoch,uint64 reviewGeneration,bytes32 antiReplayNonce,bytes32 winnerKeyHash)"
                ),
            "grant review typehash drift"
        );
        require(
            fixture.codec.STAMP_LAUNCH_ID_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphAdoptionStampLaunchIdV1(uint256 chainId,address registry,address launchWallet,bytes32 profileKey,bytes32 contractPlanHash,bytes32 sourceLaunchId)"
                ),
            "stamp launch id typehash drift"
        );
        require(
            fixture.codec.WINNER_KEY_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphAdoptionWinnerKeyV1(uint256 chainId,address registry,address launchWallet,bytes32 applicantIdHash,bytes32 profileKey,bytes32 profileDescriptorHash,bytes32 exactContractBindingHash,bytes32 sourceRepositoryHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 sourceLaunchId,bytes32 contractPlanHash,bytes32 applicantPlanArtifactHash,bytes32 componentGraphHash,bytes32 adoptionIntentHash,uint64 securityEpoch,bytes32 securityEpochHash,uint64 policyEpoch,bytes32 policyEpochHash,uint64 reviewGeneration,bytes32 reviewGenerationHash)"
                ),
            "winner key typehash drift"
        );
        require(
            fixture.codec.CANONICAL_RECEIPT_CORE_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphCanonicalReceiptCoreV1(bytes32 stampLaunchId,bytes32 sourceLaunchId,bytes32 launchGrantDigest,bytes32 launchGrantHash,bytes32 executionCurrentnessDigest,bytes32 contractPlanHash,bytes32 profileCapabilityHash,bytes32 adoptionRequestHash)"
                ),
            "receipt typehash drift"
        );
        require(
            fixture.codec.CREATION_RECEIPT_EVIDENCE_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphCreationReceiptEvidenceV1(bytes32 transactionHash,uint64 blockNumber,bytes32 blockHash,uint32 transactionIndex,address transactionSender,uint64 transactionSenderNonce,address transactionTo,uint256 transactionValueWei,bytes32 transactionInputHash,bool receiptSucceeded,address topLevelCreatedAddress,bytes32 internalCreationTraceHash,bytes32 finalityEvidenceHash,bytes32 dualProviderEvidenceHash)"
                ),
            "creation receipt evidence typehash drift"
        );
        require(
            fixture.codec.COMPONENT_CREATION_EVIDENCE_SOURCE_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphAdoptionCreationEvidenceSourceV1(uint256 chainId,address registry,bytes32 sourceRepositoryHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 sourceLaunchId,bytes32 manifestHash,bytes32 policyHash,bytes32 applicantPlanArtifactHash,address launchWallet)"
                ),
            "creation evidence source typehash drift"
        );
        require(
            fixture.codec.SHARED_COMPONENT_IDENTITY_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphSharedComponentIdentityV1(address account,uint8 kind,uint8 deploymentKind,address deployer,uint64 createNonce,bytes32 create2Salt,bytes32 initCodeHash,bytes32 creationReceiptEvidenceHash,bytes32 externalCanonicalIdHash,bytes32 runtimeCodeHash,bytes32 intrinsicConfigurationHash)"
                ),
            "shared component identity typehash drift"
        );
        require(
            fixture.codec.PREFLIGHT_QUERY_TYPEHASH()
                == keccak256("ProgrammableCompletedGraphAdoptionPreflightQueryV1(bytes32 abiEncodedQueryHash)"),
            "preflight query typehash drift"
        );
        require(
            fixture.codec.PREFLIGHT_COMPONENT_LEAF_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphAdoptionPreflightComponentLeafV1(uint8 componentIndex,address component,uint8 componentScope,bytes32 expectedSharedIdentityHash,bytes32 expectedRuntimeCodeHash,bytes32 actualRuntimeCodeHash,bytes32 exclusiveComponentOccupantStampLaunchId,bytes32 sharedComponentIdentityHash)"
                ),
            "preflight component typehash drift"
        );
        require(
            fixture.codec.PREFLIGHT_GLOBAL_HEAD_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphAdoptionPreflightGlobalHeadV1(bytes32 queryHash,bytes32 runtimeControlHash,bytes32 lifecycleHash,bytes32 reservationHash)"
                ),
            "preflight global head typehash drift"
        );
        require(
            fixture.codec.PREFLIGHT_READBACK_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphAdoptionPreflightReadbackV1(bytes32 globalReadbackHeadHash,bytes32 orderedComponentLeavesHash)"
                ),
            "preflight readback typehash drift"
        );
    }

    function _fixture() private returns (Fixture memory fixture) {
        return _fixtureWithScope(IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.Exclusive);
    }

    function _fixtureWithScope(IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1 componentScope)
        private
        returns (Fixture memory fixture)
    {
        return _fixtureWithScopeAndActivation(componentScope, true);
    }

    function _fixtureWithoutGrantActivation() private returns (Fixture memory fixture) {
        return
            _fixtureWithScopeAndActivation(
                IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.Exclusive, false
            );
    }

    function _fixtureWithScopeAndActivation(
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1 componentScope,
        bool activateGrant
    ) private returns (Fixture memory fixture) {
        fixture.codec = new ProgrammableCompletedGraphAdoptionCompatCodecV1();
        fixture.validator = new ProgrammableCompletedGraphAdoptionValidatorV1(address(fixture.codec));
        fixture.preflight = new ProgrammableCompletedGraphAdoptionPreflightV1(address(fixture.codec));
        fixture.reviewer = new CompatAuthorityV1();
        fixture.governance = new CompatAuthorityV1();
        fixture.stateVerifier = new CompatStateVerifierV1();
        fixture.finality = new CompatAuthorityV1();
        fixture.indexer = new CompatAuthorityV1();
        fixture.registry = new ProgrammableCompletedGraphAdoptionGrantRegistryV1(
            address(fixture.reviewer),
            address(fixture.governance),
            address(fixture.finality),
            address(fixture.indexer),
            address(fixture.codec),
            address(fixture.validator),
            address(fixture.preflight),
            ProgrammableCompletedGraphAdoptionGrantRegistryV1.InitialControlStateV1({
                dependencyBehaviorEvidenceHash: DEPENDENCY_BEHAVIOR_EVIDENCE_HASH,
                securityControlHeadHash: SECURITY_HEAD,
                securityEpoch: 1,
                securityEpochHash: SECURITY_EPOCH_HASH,
                policyEpoch: 1,
                policyEpochHash: POLICY_EPOCH_HASH,
                reviewGeneration: 1,
                reviewGenerationHash: REVIEW_GENERATION_HASH
            })
        );

        _buildPlanAndGraph(fixture, componentScope);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability = _capability(fixture);
        fixture.governance.register(fixture.registry, capability);
        _buildGrantRequestAndCurrentness(fixture);
        fixture.stateVerifier
            .setStates(
                fixture.adoption.request.currentArchitectureStateHash,
                fixture.adoption.request.currentPoolStateHash,
                fixture.adoption.request.currentRevenueStateHash
            );
        if (activateGrant) {
            fixture.registry.activateLaunchGrantV1(fixture.adoption.grant, hex"01");
            _bindPreflightCurrentness(fixture);
        }
    }

    function _buildPlanAndGraph(
        Fixture memory fixture,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1 componentScope
    ) private {
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 memory plan;
        bytes32 profileDescriptorHash = keccak256("compat-profile-descriptor");
        bytes32 routeSchemaHash = keccak256("compat-route-schema");
        plan.profileKey = fixture.codec.computeProfileKey(profileDescriptorHash, routeSchemaHash);
        plan.profileDescriptorHash = profileDescriptorHash;
        plan.exactContractBindingHash = keccak256("compat-contract-binding");
        plan.routeSchemaHash = routeSchemaHash;
        plan.planSchemaArtifactHash = keccak256("compat-plan-schema");
        plan.sourceRepositoryHash = keccak256("compat-source-repository");
        plan.sourceCommitId = hex"1111111111111111111111111111111111111111";
        plan.sourceTreeId = hex"2222222222222222222222222222222222222222";
        plan.sourceLaunchId = keccak256("compat-source-launch-id");
        plan.manifestHash = keccak256("compat-manifest");
        plan.policyHash = keccak256("compat-policy");
        plan.compilerArtifactHash = keccak256("compat-compiler-artifact");
        plan.applicantPlanArtifactHash = keccak256("compat-applicant-plan");
        plan.adoptionIntentHash = keccak256("compat-adoption-intent");
        plan.executionReadiness =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionReadinessV1.CompletedGraphAdoptionOnly;
        plan.executionReadinessConstraintHash = fixture.codec.ADOPTION_ONLY_READINESS_CONSTRAINT_HASH();
        plan.executionTimeConstraint =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.AdoptionOnlyNoExecution;
        plan.launchWallet = address(this);
        plan.launchClassification =
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchClassificationV1.CompletedGraphAdoption;
        plan.identityMask = 1 << 3;
        plan.architectureResultHash = keccak256("compat-architecture-result");
        plan.deploymentLineageHash = keccak256("compat-deployment-lineage");
        fixture.adoption.plan = plan;

        _buildComponentsAndPlanCommitments(fixture, componentScope);
    }

    function _buildComponentsAndPlanCommitments(
        Fixture memory fixture,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1 componentScope
    ) private {
        CompatGraphNodeV1 nodeA = new CompatGraphNodeV1(1);
        CompatGraphNodeV1 nodeB = new CompatGraphNodeV1(2);
        fixture.adoption.components = new IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[](2);
        address first = address(nodeA) < address(nodeB) ? address(nodeA) : address(nodeB);
        address second = address(nodeA) < address(nodeB) ? address(nodeB) : address(nodeA);
        fixture.adoption.components[0] = _externalComponent(
            first,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Application,
            componentScope,
            keccak256("compat-primary-application")
        );
        fixture.adoption.components[1] = _externalComponent(
            second,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Auxiliary,
            componentScope,
            keccak256("compat-auxiliary")
        );
        for (uint256 i; i < fixture.adoption.components.length; ++i) {
            fixture.adoption.components[i].creationEvidenceHash = fixture.codec
                .computeComponentCreationEvidenceHash(
                    address(fixture.registry), fixture.adoption.plan, i, fixture.adoption.components[i]
                );
            fixture.adoption.components[i].configurationHash =
                fixture.codec.computeComponentConfigurationHash(fixture.adoption.components[i]);
        }
        fixture.adoption.plan.identities.applicationHash =
            fixture.codec.computeApplicationIdentityHash(fixture.adoption.components[0]);
        fixture.adoption.edges = new IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[](1);
        fixture.adoption.edges[0] = IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1({
            fromIndex: 0,
            toIndex: 1,
            kind: IProgrammableCompletedGraphAdoptionCompatV1.EdgeKindV1.Controls,
            relationHash: keccak256("compat-edge")
        });
        fixture.adoption.plan.componentGraphHash =
            fixture.codec.computeComponentGraphHash(fixture.adoption.components, fixture.adoption.edges);
        fixture.adoption.plan.exactRuntimeSetHash =
            fixture.codec.computeExactRuntimeSetHash(fixture.adoption.components);
        fixture.adoption.plan.componentConfigurationSetHash =
            fixture.codec.computeComponentConfigurationSetHash(fixture.adoption.components);
        fixture.adoption.plan.configurationHash = fixture.codec
            .computeConfigurationHash(
                fixture.adoption.plan.componentGraphHash,
                fixture.adoption.plan.componentConfigurationSetHash,
                fixture.adoption.plan.policyHash,
                fixture.adoption.plan.revenueBindingHash,
                address(0),
                bytes32(0),
                bytes32(0),
                fixture.adoption.plan.architectureResultHash
            );
        fixture.adoption.plan.resultHash = fixture.codec
            .computeResultHash(
                fixture.adoption.plan.componentGraphHash,
                fixture.adoption.plan.configurationHash,
                fixture.adoption.plan.architectureResultHash,
                bytes32(0),
                fixture.adoption.plan.deploymentLineageHash
            );
    }

    function _buildGrantRequestAndCurrentness(Fixture memory fixture) private view {
        _buildGrantRequestAndCurrentness(fixture, keccak256("compat-initial-winner-seed"));
    }

    function _buildGrantRequestAndCurrentness(Fixture memory fixture, bytes32 winnerSeed) private view {
        ControlSnapshotV1 memory controls = _controlSnapshot(fixture.registry);
        bytes32 planHash = fixture.codec.computePlanHash(fixture.adoption.plan);
        bytes32 stampLaunchId = fixture.codec
            .computeStampLaunchId(
                address(fixture.registry),
                fixture.adoption.plan.launchWallet,
                fixture.adoption.plan.profileKey,
                planHash,
                fixture.adoption.plan.sourceLaunchId
            );
        fixture.adoption.request = IProgrammableCompletedGraphAdoptionCompatV1.AdoptionRequestV1({
            stampLaunchId: stampLaunchId,
            profileKey: fixture.adoption.plan.profileKey,
            componentGraphHash: fixture.adoption.plan.componentGraphHash,
            resultHash: fixture.adoption.plan.resultHash,
            currentArchitectureStateHash: keccak256("compat-current-architecture"),
            currentPoolStateHash: bytes32(0),
            currentRevenueStateHash: bytes32(0)
        });
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory grant;
        grant.chainId = block.chainid;
        grant.registry = address(fixture.registry);
        grant.launchWallet = address(this);
        grant.applicantIdHash = keccak256("compat-applicant");
        grant.profileKey = fixture.adoption.plan.profileKey;
        grant.profileDescriptorHash = fixture.adoption.plan.profileDescriptorHash;
        grant.exactContractBindingHash = fixture.adoption.plan.exactContractBindingHash;
        grant.contractPlanHash = planHash;
        grant.applicantPlanArtifactHash = fixture.adoption.plan.applicantPlanArtifactHash;
        grant.adoptionIntentHash = fixture.adoption.plan.adoptionIntentHash;
        grant.executionReadiness = fixture.adoption.plan.executionReadiness;
        grant.executionReadinessConstraintHash = fixture.adoption.plan.executionReadinessConstraintHash;
        grant.executionTimeConstraint = fixture.adoption.plan.executionTimeConstraint;
        grant.sourceRepositoryHash = fixture.adoption.plan.sourceRepositoryHash;
        grant.sourceCommitHash = fixture.codec.computeSourceCommitHash(fixture.adoption.plan.sourceCommitId);
        grant.sourceTreeHash = fixture.codec.computeSourceTreeHash(fixture.adoption.plan.sourceTreeId);
        grant.sourceLaunchId = fixture.adoption.plan.sourceLaunchId;
        grant.componentGraphHash = fixture.adoption.plan.componentGraphHash;
        grant.exactRuntimeSetHash = fixture.adoption.plan.exactRuntimeSetHash;
        grant.componentConfigurationSetHash = fixture.adoption.plan.componentConfigurationSetHash;
        grant.revenueBindingHash = fixture.adoption.plan.revenueBindingHash;
        grant.resultHash = fixture.adoption.plan.resultHash;
        grant.builderEvidenceHash = keccak256(abi.encode("compat-builder-evidence", winnerSeed));
        grant.reviewerAttestationHash = keccak256(abi.encode("compat-reviewer-attestation", winnerSeed));
        grant.securityControlHeadHash = controls.securityControlHeadHash;
        grant.securityEpochHash = controls.securityEpochHash;
        grant.policyHash = fixture.adoption.plan.policyHash;
        grant.policyEpochHash = controls.policyEpochHash;
        grant.securityEpoch = controls.securityEpoch;
        grant.policyEpoch = controls.policyEpoch;
        grant.reviewControl = IProgrammableCompletedGraphAdoptionCompatV1.ReviewGenerationV1({
            reviewGenerationHash: controls.reviewGenerationHash, reviewGeneration: controls.reviewGeneration
        });
        grant.antiReplayNonce = keccak256(abi.encode("compat-one-winner-nonce", winnerSeed));
        grant.winnerKeyHash = fixture.codec.computeWinnerKeyHash(grant);
        fixture.adoption.grant = grant;

        bytes32 grantDigest = fixture.registry.launchGrantDigest(grant);

        fixture.adoption.currentness = IProgrammableCompletedGraphAdoptionCompatV1.ExecutionCurrentnessV1({
            chainId: block.chainid,
            registry: address(fixture.registry),
            launchWallet: address(this),
            launchGrantDigest: grantDigest,
            contractPlanHash: planHash,
            receiptRequestHash: fixture.codec.computeAdoptionRequestHash(fixture.adoption.request),
            preflightReadbackHash: bytes32(0),
            simulationEvidenceHash: bytes32(0),
            serviceDeploymentBindingHash: bytes32(0),
            dualProviderQuorumEvidenceHash: bytes32(0),
            expectedResultHash: fixture.adoption.plan.resultHash,
            adoptionIntentHash: fixture.adoption.plan.adoptionIntentHash,
            securityControlHeadHash: controls.securityControlHeadHash,
            securityEpochHash: controls.securityEpochHash,
            policyEpochHash: controls.policyEpochHash,
            securityEpoch: controls.securityEpoch,
            policyEpoch: controls.policyEpoch,
            reviewControl: IProgrammableCompletedGraphAdoptionCompatV1.ReviewGenerationV1({
                reviewGenerationHash: controls.reviewGenerationHash, reviewGeneration: controls.reviewGeneration
            }),
            nonce: keccak256(abi.encode("compat-currentness-nonce", winnerSeed)),
            validAfter: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 1 hours)
        });
        fixture.adoption.currentnessSignature = hex"01";
    }

    function _adoptionSucceeds(Fixture memory fixture) private returns (bool success) {
        (success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
    }

    function _createAddressAtNonceZero(address deployer) private pure returns (address) {
        return _createAddress(deployer, 0);
    }

    function _createAddress(address deployer, uint64 nonce) private pure returns (address) {
        if (nonce == 0) {
            return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, hex"80")))));
        }
        require(nonce <= 0x7f, "test helper nonce too large");
        // The preceding bound proves nonce fits in one RLP byte.
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, bytes1(uint8(nonce)))))));
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }

    function _validationSucceeds(
        Fixture memory fixture,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability
    ) private returns (bool success) {
        (success,) = address(fixture.validator)
            .call(
                abi.encodeCall(
                    fixture.validator.validateCompletedGraphV1,
                    (
                        address(fixture.registry),
                        capability,
                        fixture.adoption.plan,
                        fixture.adoption.grant.sourceCommitHash,
                        fixture.adoption.grant.sourceTreeHash,
                        fixture.adoption.components,
                        fixture.adoption.edges,
                        fixture.adoption.request
                    )
                )
            );
    }

    function _requireWinnerKeyChanged(
        Fixture memory fixture,
        bytes32 baselineKey,
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory mutated
    ) private pure {
        require(fixture.codec.computeWinnerKeyHash(mutated) != baselineKey, "winner domain axis omitted");
    }

    function _cloneGrant(IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory grant)
        private
        pure
        returns (IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory)
    {
        return abi.decode(abi.encode(grant), (IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1));
    }

    function _controlSnapshot(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry)
        private
        view
        returns (ControlSnapshotV1 memory controls)
    {
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightControlStateV1 memory state =
            registry.preflightControlStateV1(bytes32(0));
        controls.securityControlHeadHash = state.securityControlHeadHash;
        controls.securityEpoch = state.securityEpoch;
        controls.securityEpochHash = state.securityEpochHash;
        controls.policyEpoch = state.policyEpoch;
        controls.policyEpochHash = state.policyEpochHash;
        controls.reviewGeneration = state.reviewControl.reviewGeneration;
        controls.reviewGenerationHash = state.reviewControl.reviewGenerationHash;
    }

    function _grantStateHead(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bytes32 grantDigest)
        private
        view
        returns (IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantStateHeadV1 memory)
    {
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query;
        query.launchGrantDigest = grantDigest;
        return registry.preflightGrantReceiptStateV1(query, bytes32(0)).grantStateHead;
    }

    function _grantStatus(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bytes32 grantDigest)
        private
        view
        returns (IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1)
    {
        return _grantStateHead(registry, grantDigest).status;
    }

    function _receiptStatus(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bytes32 stampLaunchId)
        private
        view
        returns (IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1)
    {
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query;
        query.stampLaunchId = stampLaunchId;
        return registry.preflightGrantReceiptStateV1(query, bytes32(0)).receiptStatus;
    }

    function _finalityIndexingHash(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bytes32 stampLaunchId)
        private
        view
        returns (bytes32)
    {
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query;
        query.stampLaunchId = stampLaunchId;
        return registry.preflightGrantReceiptStateV1(query, bytes32(0)).finalityIndexingReceiptHash;
    }

    function _profileStatus(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bytes32 profileKey)
        private
        view
        returns (IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1)
    {
        return registry.preflightControlStateV1(profileKey).profileStatus;
    }

    function _globalKilled(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry) private view returns (bool) {
        return registry.preflightControlStateV1(bytes32(0)).globalAdoptionKilled;
    }

    function _sortTwoComponents(IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] memory components)
        private
        pure
    {
        if (components[0].account <= components[1].account) return;
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 memory first = components[0];
        components[0] = components[1];
        components[1] = first;
    }

    function _refreshPlanCommitments(Fixture memory fixture) private view {
        for (uint256 i; i < fixture.adoption.components.length; ++i) {
            fixture.adoption.components[i].creationEvidenceHash = fixture.codec
                .computeComponentCreationEvidenceHash(
                    address(fixture.registry), fixture.adoption.plan, i, fixture.adoption.components[i]
                );
            fixture.adoption.components[i].configurationHash =
                fixture.codec.computeComponentConfigurationHash(fixture.adoption.components[i]);
            if (
                fixture.adoption.components[i].kind
                    == IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Application
            ) {
                fixture.adoption.plan.identities.applicationHash =
                    fixture.codec.computeApplicationIdentityHash(fixture.adoption.components[i]);
            }
        }
        fixture.adoption.plan.componentGraphHash =
            fixture.codec.computeComponentGraphHash(fixture.adoption.components, fixture.adoption.edges);
        fixture.adoption.plan.exactRuntimeSetHash =
            fixture.codec.computeExactRuntimeSetHash(fixture.adoption.components);
        fixture.adoption.plan.componentConfigurationSetHash =
            fixture.codec.computeComponentConfigurationSetHash(fixture.adoption.components);
        fixture.adoption.plan.configurationHash = fixture.codec
            .computeConfigurationHash(
                fixture.adoption.plan.componentGraphHash,
                fixture.adoption.plan.componentConfigurationSetHash,
                fixture.adoption.plan.policyHash,
                fixture.adoption.plan.revenueBindingHash,
                fixture.adoption.plan.poolManager,
                fixture.adoption.plan.poolManagerRuntimeCodeHash,
                fixture.adoption.plan.poolKeyHash,
                fixture.adoption.plan.architectureResultHash
            );
        fixture.adoption.plan.resultHash = fixture.codec
            .computeResultHash(
                fixture.adoption.plan.componentGraphHash,
                fixture.adoption.plan.configurationHash,
                fixture.adoption.plan.architectureResultHash,
                fixture.adoption.plan.poolResultHash,
                fixture.adoption.plan.deploymentLineageHash
            );
        fixture.adoption.request.componentGraphHash = fixture.adoption.plan.componentGraphHash;
        fixture.adoption.request.resultHash = fixture.adoption.plan.resultHash;
    }

    function _rebindAsDistinctReviewedPlan(Fixture memory fixture, bytes32 winnerSeed) private {
        fixture.adoption.plan.sourceCommitId =
            bytes20(keccak256(abi.encode("compat-successor-source-commit", winnerSeed)));
        fixture.adoption.plan.sourceTreeId = bytes20(keccak256(abi.encode("compat-successor-source-tree", winnerSeed)));
        fixture.adoption.plan.applicantPlanArtifactHash =
            keccak256(abi.encode("compat-successor-plan-artifact", winnerSeed));
        fixture.adoption.plan.adoptionIntentHash = keccak256(abi.encode("compat-successor-adoption-intent", winnerSeed));
        fixture.adoption.edges[0].relationHash = keccak256(abi.encode("compat-successor-edge", winnerSeed));
        _refreshPlanCommitments(fixture);
        _buildGrantRequestAndCurrentness(fixture, winnerSeed);
        fixture.stateVerifier
            .setStates(
                fixture.adoption.request.currentArchitectureStateHash,
                fixture.adoption.request.currentPoolStateHash,
                fixture.adoption.request.currentRevenueStateHash
            );
        fixture.registry.activateLaunchGrantV1(fixture.adoption.grant, hex"01");
        _bindPreflightCurrentness(fixture);
    }

    function _preflightQuery(Fixture memory fixture)
        private
        view
        returns (IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query)
    {
        query.profileKey = fixture.adoption.plan.profileKey;
        query.launchGrantDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);
        query.expectedContractPlanHash = fixture.codec.computePlanHash(fixture.adoption.plan);
        query.stampLaunchId = fixture.adoption.request.stampLaunchId;
        query.antiReplayNonce = fixture.adoption.grant.antiReplayNonce;
        query.winnerKeyHash = fixture.adoption.grant.winnerKeyHash;
        query.componentGraphHash = fixture.adoption.plan.componentGraphHash;
        query.exclusiveToken = fixture.adoption.plan.identities.token;
        query.poolManager = fixture.adoption.plan.poolManager;
        query.poolId = fixture.adoption.plan.poolId;
        query.currentnessNonce = fixture.adoption.currentness.nonce;
    }

    function _bindPreflightCurrentness(Fixture memory fixture) private view {
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query = _preflightQuery(fixture);

        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightReadbackV1 memory globalReadback =
            fixture.preflight.adoptionPreflightReadbackV1(address(fixture.registry), query, bytes32(0));
        bytes32[] memory componentLeaves = new bytes32[](fixture.adoption.components.length);
        for (uint256 i; i < fixture.adoption.components.length; ++i) {
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 memory component = fixture.adoption.components[i];
            // forge-lint: disable-next-line(unsafe-typecast)
            query.componentIndex = uint8(i);
            query.component = component.account;
            query.componentScope = component.scope;
            query.expectedSharedIdentityHash = component.scope
                == IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.SharedInfrastructure
                ? fixture.codec.computeSharedComponentIdentityHash(component)
                : bytes32(0);
            query.expectedRuntimeCodeHash = component.runtimeCodeHash;
            componentLeaves[i] =
            fixture.preflight
            .adoptionPreflightReadbackV1(address(fixture.registry), query, bytes32(0))
            .componentLeafHash;
        }
        fixture.adoption.currentness.preflightReadbackHash = fixture.codec
            .computeAdoptionPreflightReadbackHash(
                globalReadback.globalReadbackHeadHash, keccak256(abi.encodePacked(componentLeaves))
            );
        fixture.adoption.currentness.simulationEvidenceHash = keccak256(
            abi.encode(
                "compat-pre-sign-validator-simulation-v1",
                globalReadback.globalReadbackHeadHash,
                fixture.adoption.currentness.preflightReadbackHash
            )
        );
        fixture.adoption.currentness.serviceDeploymentBindingHash =
            keccak256("compat-content-addressed-service-deployment-v1");
        fixture.adoption.currentness.dualProviderQuorumEvidenceHash = keccak256(
            abi.encode(
                "compat-dual-independent-provider-quorum-v1",
                globalReadback.globalReadbackHeadHash,
                fixture.adoption.currentness.preflightReadbackHash
            )
        );
    }

    function _assertAuthorityModeRejects(uint8 signatureMode, bool mutateDigest) private {
        Fixture memory fixture = _fixture();
        if (mutateDigest) {
            fixture.reviewer
                .setExpectedDigest(fixture.registry.executionCurrentnessDigest(fixture.adoption.currentness));
        }
        fixture.reviewer.setSignatureMode(signatureMode);
        if (mutateDigest) {
            fixture.adoption.currentness.nonce = keccak256("compat-mutated-currentness-digest");
        }
        require(!_adoptionSucceeds(fixture), "invalid ERC1271 response accepted");
        require(
            _grantStatus(fixture.registry, fixture.registry.launchGrantDigest(fixture.adoption.grant))
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "invalid ERC1271 response consumed grant"
        );
    }

    function _finalityReceipt(
        Fixture memory fixture,
        bytes32 stampLaunchId,
        bytes32 receiptCoreHash,
        IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1 nextStatus,
        bytes32 previousHash,
        bytes32 evidenceHash
    ) private view returns (IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory receipt) {
        receipt.stampLaunchId = stampLaunchId;
        receipt.receiptCoreHash = receiptCoreHash;
        receipt.launchGrantDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);
        receipt.nextStatus = nextStatus;
        receipt.previousFinalityIndexingReceiptHash = previousHash;
        receipt.evidenceHash = evidenceHash;
        receipt.finalityIndexingReceiptHash = fixture.codec.computeFinalityIndexingReceiptHash(receipt);
    }

    function _capability(Fixture memory fixture)
        private
        view
        returns (IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability)
    {
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightControlStateV1 memory control =
            fixture.registry.preflightControlStateV1(fixture.adoption.plan.profileKey);
        uint64 reviewGeneration = control.reviewControl.reviewGeneration;
        bytes32 reviewGenerationHash = control.reviewControl.reviewGenerationHash;
        capability.profileKey = fixture.adoption.plan.profileKey;
        capability.profileDescriptorHash = fixture.adoption.plan.profileDescriptorHash;
        capability.exactContractBindingHash = fixture.adoption.plan.exactContractBindingHash;
        capability.routeSchemaHash = fixture.adoption.plan.routeSchemaHash;
        capability.planSchemaArtifactHash = fixture.adoption.plan.planSchemaArtifactHash;
        capability.policyHash = fixture.adoption.plan.policyHash;
        capability.stateVerifierBinding = IProgrammableCompletedGraphAdoptionCompatV1.StateVerifierBindingV1({
            stateVerifier: address(fixture.stateVerifier),
            stateVerifierRuntimeCodeHash: address(fixture.stateVerifier).codehash,
            stateSchemaHash: keccak256("compat-state-schema-v1"),
            stateVerifierBehaviorEvidenceHash: keccak256("compat-state-verifier-behavior-evidence-v1")
        });
        capability.reviewControl = IProgrammableCompletedGraphAdoptionCompatV1.ReviewGenerationV1({
            reviewGenerationHash: reviewGenerationHash, reviewGeneration: reviewGeneration
        });
        capability.capabilitySemantics = IProgrammableCompletedGraphAdoptionCompatV1.CapabilitySemanticsV1.Adopt;
        capability.admissionStatus = IProgrammableCompletedGraphAdoptionCompatV1.AdmissionStatusV1.Admitted;
        capability.launchClassification = fixture.adoption.plan.launchClassification;
        capability.executionReadiness = fixture.adoption.plan.executionReadiness;
        capability.executionReadinessConstraintHash = fixture.adoption.plan.executionReadinessConstraintHash;
        capability.executionTimeConstraint =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.AdoptionOnlyNoExecution;
        capability.requiredIdentityMask = fixture.adoption.plan.identityMask;
        capability.enabled = true;
    }

    function _externalComponent(
        address account,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1 kind,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1 scope,
        bytes32 externalCanonicalIdHash
    ) private view returns (IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 memory component) {
        component.account = account;
        component.kind = kind;
        component.scope = scope;
        component.deploymentKind = IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.ExternalCanonical;
        component.externalCanonicalIdHash = externalCanonicalIdHash;
        component.runtimeCodeHash = account.codehash;
    }
}
