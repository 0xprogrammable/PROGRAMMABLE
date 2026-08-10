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
        bytes32 policyEpochHash
    ) external {
        registry.advanceSecurityPolicyEpochsV1(
            securityControlHeadHash, securityEpoch, securityEpochHash, policyEpoch, policyEpochHash
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

    struct Fixture {
        ProgrammableCompletedGraphAdoptionCompatCodecV1 codec;
        ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry;
        CompatAuthorityV1 reviewer;
        CompatAuthorityV1 governance;
        CompatAuthorityV1 finality;
        CompatAuthorityV1 indexer;
        CompatStateVerifierV1 stateVerifier;
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphAdoptionV1 adoption;
    }

    function testAdoptConsumesEvergreenGrantAndAnchorsCanonicalReceipt() external {
        Fixture memory fixture = _fixture();
        bytes32 coreHash = fixture.registry.adoptCompletedGraphV1(fixture.adoption);
        bytes32 grantDigest = fixture.adoption.grant.grantDigest;
        bytes32 launchId = fixture.adoption.request.launchId;

        require(coreHash != bytes32(0), "empty core hash");
        require(
            fixture.registry.launchGrantStatus(grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Consumed,
            "grant not consumed"
        );
        require(
            fixture.registry.receiptStatus(launchId)
                == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Adopted,
            "receipt not adopted"
        );
        IProgrammableCompletedGraphAdoptionCompatV1.CanonicalReceiptCoreV1 memory core =
            fixture.registry.canonicalReceiptCore(launchId);
        require(core.receiptCoreHash == coreHash, "receipt self hash mismatch");
        require(core.launchGrantDigest == grantDigest, "grant digest mismatch");
        require(core.launchGrantHash == fixture.adoption.grant.grantHash, "grant hash mismatch");
        require(core.contractPlanHash == fixture.adoption.grant.contractPlanHash, "plan hash mismatch");
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
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
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
        bytes32 grantDigest = fixture.adoption.grant.grantDigest;
        fixture.governance.revokeGrant(fixture.registry, grantDigest);

        require(
            fixture.registry.launchGrantStatus(grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Revoked,
            "grant did not become revoked"
        );
        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "revoked grant accepted");
        require(
            fixture.registry.launchGrantStatus(grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Revoked,
            "failed adoption changed revoked grant"
        );
    }

    function testGrantHashAndDigestVectorRemainStable() external {
        Fixture memory fixture = _fixture();
        require(
            fixture.codec.computeLaunchGrantHash(fixture.adoption.grant) == fixture.adoption.grant.grantHash,
            "grant hash drift"
        );
        require(
            fixture.registry.launchGrantDigest(fixture.adoption.grant) == fixture.adoption.grant.grantDigest,
            "grant digest drift"
        );
        require(
            fixture.codec.computePlanHash(fixture.adoption.plan) == fixture.adoption.grant.contractPlanHash,
            "plan hash drift"
        );
    }

    function testYearsLaterFreshCurrentnessConsumesTheSameActiveGrant() external {
        Fixture memory fixture = _fixture();
        VM.warp(block.timestamp + 730 days);
        fixture.adoption.currentness.nonce = keccak256("compat-years-later-currentness-nonce");
        fixture.adoption.currentness.validAfter = uint64(block.timestamp);
        fixture.adoption.currentness.deadline = uint64(block.timestamp + 1 hours);

        fixture.registry.adoptCompletedGraphV1(fixture.adoption);
        require(
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
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
                keccak256("compat-policy-epoch-v2")
            );

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "stale currentness accepted after epoch advance");
        require(
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "epoch block revoked evergreen grant"
        );
    }

    function testFreshCurrentnessAtNewEpochCannotConsumeOldGrant() external {
        Fixture memory fixture = _fixture();
        bytes32 newHead = keccak256("compat-security-head-v2");
        bytes32 newSecurityEpochHash = keccak256("compat-security-epoch-v2");
        bytes32 newPolicyEpochHash = keccak256("compat-policy-epoch-v2");
        fixture.governance.advanceEpochs(fixture.registry, newHead, 2, newSecurityEpochHash, 2, newPolicyEpochHash);
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
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "failed rebind check consumed grant"
        );
    }

    function testGlobalKillBlocksActivationAndConsumptionUntilEpochRebind() external {
        Fixture memory fixture = _fixture();
        fixture.governance.setGlobalKill(fixture.registry, true);
        require(fixture.registry.globalAdoptionKilledV1(), "global kill not recorded");
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
                keccak256("compat-policy-epoch-after-kill")
            );
        fixture.governance.setGlobalKill(fixture.registry, false);
        require(!fixture.registry.globalAdoptionKilledV1(), "global kill did not clear after epoch advance");
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
            fixture.registry.adoptionProfileStatusV1(profileKey)
                == IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Suspended,
            "profile not suspended"
        );
        require(!_adoptionSucceeds(fixture), "suspended profile consumed grant");
        (bool activationSucceeded,) = address(fixture.registry)
            .call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (fixture.adoption.grant, hex"01")));
        require(!activationSucceeded, "suspended profile allowed activation");

        fixture.governance
            .setProfileStatus(
                fixture.registry, profileKey, IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Deprecated
            );
        require(
            fixture.registry.adoptionProfileStatusV1(profileKey)
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
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
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
        component.createTransactionEvidence = IProgrammableCompletedGraphAdoptionCompatV1.CreateTransactionEvidenceV1({
            transactionHash: keccak256("compat-create-nonce-zero-tx"),
            blockNumber: 1,
            blockHash: keccak256("compat-create-nonce-zero-block"),
            transactionIndex: 0,
            sender: deployer,
            senderNonce: 0,
            to: address(0),
            valueWei: 0,
            inputHash: component.initCodeHash,
            receiptSucceeded: true,
            createdAddress: created,
            finalityEvidenceHash: keccak256("compat-create-nonce-zero-finality"),
            dualProviderEvidenceHash: keccak256("compat-create-nonce-zero-dual-provider")
        });
        fixture.adoption.components[0] = component;
        _sortTwoComponents(fixture.adoption.components);
        _refreshPlanCommitments(fixture);

        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability = _capability(fixture);
        fixture.registry.VALIDATOR()
            .validateCompletedGraphV1(
                address(fixture.registry),
                capability,
                fixture.adoption.plan,
                fixture.adoption.components,
                fixture.adoption.edges,
                fixture.adoption.request
            );
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
        fixture.adoption.grant.oneWinnerNonce = keccak256("compat-external-time-bound-nonce");
        fixture.adoption.grant.grantHash = fixture.codec.computeLaunchGrantHash(fixture.adoption.grant);
        fixture.adoption.grant.grantDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);

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
        proxyBound.stateVerifier = address(proxy);
        proxyBound.stateVerifierRuntimeCodeHash = address(proxy).codehash;
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
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "failed legacy migration consumed grant"
        );
    }

    function testWinnerKeyReservationRejectsCompetingGrant() external {
        Fixture memory fixture = _fixture();
        bytes32 incumbentDigest = fixture.adoption.grant.grantDigest;
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory competing = fixture.adoption.grant;
        competing.contractPlanHash = keccak256("compat-competing-reviewed-plan");
        competing.oneWinnerNonce = keccak256("compat-competing-winner-nonce");
        competing.grantHash = fixture.codec.computeLaunchGrantHash(competing);
        competing.grantDigest = fixture.registry.launchGrantDigest(competing);

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (competing, hex"01")));
        require(!success, "winner key allowed competing grant");
        require(
            fixture.registry.launchGrantStatus(incumbentDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "competing activation disturbed incumbent grant"
        );
    }

    function testFuzzWinnerKeyHasExactlyOneActiveGrant(bytes32 competingNonce) external {
        Fixture memory fixture = _fixture();
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory competing = fixture.adoption.grant;
        competing.contractPlanHash = keccak256(abi.encode("compat-fuzz-competing-plan", competingNonce));
        competing.oneWinnerNonce = competingNonce;
        competing.grantHash = fixture.codec.computeLaunchGrantHash(competing);
        competing.grantDigest = fixture.registry.launchGrantDigest(competing);

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (competing, hex"01")));
        require(!success, "second grant won an occupied winner key");
    }

    function testFinalityAndIndexingOnlyAppendToTheImmutableReceiptCore() external {
        Fixture memory fixture = _fixture();
        bytes32 coreHash = fixture.registry.adoptCompletedGraphV1(fixture.adoption);
        bytes32 launchId = fixture.adoption.request.launchId;
        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory finalityReceipt = _finalityReceipt(
            fixture,
            launchId,
            coreHash,
            IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Finalized,
            bytes32(0),
            keccak256("compat-finality-evidence")
        );
        fixture.finality.advanceFinality(fixture.registry, finalityReceipt);
        require(
            fixture.registry.receiptStatus(launchId)
                == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Finalized,
            "receipt did not finalize"
        );

        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory indexingReceipt = _finalityReceipt(
            fixture,
            launchId,
            coreHash,
            IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Indexed,
            finalityReceipt.finalityIndexingReceiptHash,
            keccak256("compat-indexing-evidence")
        );
        fixture.indexer.advanceFinality(fixture.registry, indexingReceipt);
        require(
            fixture.registry.receiptStatus(launchId)
                == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Indexed,
            "receipt did not index"
        );

        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory publishedReceipt = _finalityReceipt(
            fixture,
            launchId,
            coreHash,
            IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Published,
            indexingReceipt.finalityIndexingReceiptHash,
            keccak256("compat-publication-evidence")
        );
        fixture.indexer.advanceFinality(fixture.registry, publishedReceipt);
        require(
            fixture.registry.receiptStatus(launchId)
                == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Published,
            "receipt did not publish"
        );
        require(
            fixture.registry.canonicalReceiptCore(launchId).receiptCoreHash == coreHash, "append rewrote receipt core"
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
            fixture.codec.LAUNCH_GRANT_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphLaunchGrantV1(bytes32 bindingAHash,bytes32 bindingBHash,bytes32 reviewHash)"
                ),
            "grant typehash drift"
        );
        require(
            fixture.codec.CANONICAL_RECEIPT_CORE_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphCanonicalReceiptCoreV1(bytes32 launchId,bytes32 launchGrantDigest,bytes32 launchGrantHash,bytes32 executionCurrentnessDigest,bytes32 contractPlanHash,bytes32 profileCapabilityHash,bytes32 adoptionRequestHash)"
                ),
            "receipt typehash drift"
        );
        require(
            fixture.codec.CREATE_TRANSACTION_EVIDENCE_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphCreateTransactionEvidenceV1(bytes32 transactionHash,uint64 blockNumber,bytes32 blockHash,uint32 transactionIndex,address sender,uint64 senderNonce,address to,uint256 valueWei,bytes32 inputHash,bool receiptSucceeded,address createdAddress,bytes32 finalityEvidenceHash,bytes32 dualProviderEvidenceHash)"
                ),
            "create evidence typehash drift"
        );
    }

    function _fixture() private returns (Fixture memory fixture) {
        fixture.codec = new ProgrammableCompletedGraphAdoptionCompatCodecV1();
        ProgrammableCompletedGraphAdoptionValidatorV1 validator =
            new ProgrammableCompletedGraphAdoptionValidatorV1(address(fixture.codec));
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
            address(validator),
            SECURITY_HEAD,
            1,
            SECURITY_EPOCH_HASH,
            1,
            POLICY_EPOCH_HASH
        );

        _buildPlanAndGraph(fixture);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability = _capability(fixture);
        fixture.governance.register(fixture.registry, capability);
        _buildGrantRequestAndCurrentness(fixture);
        fixture.stateVerifier
            .setStates(
                fixture.adoption.request.currentArchitectureStateHash,
                fixture.adoption.request.currentPoolStateHash,
                fixture.adoption.request.currentRevenueStateHash
            );
        fixture.registry.activateLaunchGrantV1(fixture.adoption.grant, hex"01");
    }

    function _buildPlanAndGraph(Fixture memory fixture) private {
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 memory plan;
        bytes32 profileDescriptorHash = keccak256("compat-profile-descriptor");
        bytes32 routeSchemaHash = keccak256("compat-route-schema");
        plan.profileKey = fixture.codec.computeProfileKey(profileDescriptorHash, routeSchemaHash);
        plan.profileDescriptorHash = profileDescriptorHash;
        plan.exactContractBindingHash = keccak256("compat-contract-binding");
        plan.routeSchemaHash = routeSchemaHash;
        plan.planSchemaArtifactHash = keccak256("compat-plan-schema");
        plan.sourceRepositoryHash = keccak256("compat-source-repository");
        plan.sourceCommitHash = keccak256("compat-source-commit");
        plan.sourceTreeHash = keccak256("compat-source-tree");
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

        _buildComponentsAndPlanCommitments(fixture);
    }

    function _buildComponentsAndPlanCommitments(Fixture memory fixture) private {
        CompatGraphNodeV1 nodeA = new CompatGraphNodeV1(1);
        CompatGraphNodeV1 nodeB = new CompatGraphNodeV1(2);
        fixture.adoption.components = new IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[](2);
        address first = address(nodeA) < address(nodeB) ? address(nodeA) : address(nodeB);
        address second = address(nodeA) < address(nodeB) ? address(nodeB) : address(nodeA);
        fixture.adoption.components[0] = _externalComponent(
            first,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Application,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.Exclusive,
            keccak256("compat-primary-application")
        );
        fixture.adoption.components[1] = _externalComponent(
            second,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Auxiliary,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.Exclusive,
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
        bytes32 planHash = fixture.codec.computePlanHash(fixture.adoption.plan);
        bytes32 launchId = fixture.codec
            .computeLaunchId(
                address(fixture.registry),
                fixture.adoption.plan.launchWallet,
                fixture.adoption.plan.profileKey,
                planHash
            );
        fixture.adoption.request = IProgrammableCompletedGraphAdoptionCompatV1.AdoptionRequestV1({
            launchId: launchId,
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
        grant.sourceCommitHash = fixture.adoption.plan.sourceCommitHash;
        grant.sourceTreeHash = fixture.adoption.plan.sourceTreeHash;
        grant.componentGraphHash = fixture.adoption.plan.componentGraphHash;
        grant.exactRuntimeSetHash = fixture.adoption.plan.exactRuntimeSetHash;
        grant.componentConfigurationSetHash = fixture.adoption.plan.componentConfigurationSetHash;
        grant.revenueBindingHash = fixture.adoption.plan.revenueBindingHash;
        grant.resultHash = fixture.adoption.plan.resultHash;
        grant.builderEvidenceHash = keccak256("compat-builder-evidence");
        grant.reviewerAttestationHash = keccak256("compat-reviewer-attestation");
        grant.securityControlHeadHash = SECURITY_HEAD;
        grant.securityEpochHash = SECURITY_EPOCH_HASH;
        grant.policyHash = fixture.adoption.plan.policyHash;
        grant.policyEpochHash = POLICY_EPOCH_HASH;
        grant.securityEpoch = 1;
        grant.policyEpoch = 1;
        grant.oneWinnerNonce = keccak256("compat-one-winner-nonce");
        grant.winnerKeyHash = keccak256("compat-winner-key");
        grant.grantHash = fixture.codec.computeLaunchGrantHash(grant);
        grant.grantDigest = fixture.registry.launchGrantDigest(grant);
        fixture.adoption.grant = grant;

        fixture.adoption.currentness = IProgrammableCompletedGraphAdoptionCompatV1.ExecutionCurrentnessV1({
            chainId: block.chainid,
            registry: address(fixture.registry),
            launchWallet: address(this),
            launchGrantDigest: grant.grantDigest,
            contractPlanHash: planHash,
            receiptRequestHash: fixture.codec.computeAdoptionRequestHash(fixture.adoption.request),
            expectedResultHash: fixture.adoption.plan.resultHash,
            adoptionIntentHash: fixture.adoption.plan.adoptionIntentHash,
            securityControlHeadHash: SECURITY_HEAD,
            securityEpochHash: SECURITY_EPOCH_HASH,
            policyEpochHash: POLICY_EPOCH_HASH,
            securityEpoch: 1,
            policyEpoch: 1,
            nonce: keccak256("compat-currentness-nonce"),
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
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, hex"80")))));
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
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "invalid ERC1271 response consumed grant"
        );
    }

    function _finalityReceipt(
        Fixture memory fixture,
        bytes32 launchId,
        bytes32 receiptCoreHash,
        IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1 nextStatus,
        bytes32 previousHash,
        bytes32 evidenceHash
    ) private pure returns (IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory receipt) {
        receipt.launchId = launchId;
        receipt.receiptCoreHash = receiptCoreHash;
        receipt.launchGrantDigest = fixture.adoption.grant.grantDigest;
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
        capability.profileKey = fixture.adoption.plan.profileKey;
        capability.profileDescriptorHash = fixture.adoption.plan.profileDescriptorHash;
        capability.exactContractBindingHash = fixture.adoption.plan.exactContractBindingHash;
        capability.routeSchemaHash = fixture.adoption.plan.routeSchemaHash;
        capability.planSchemaArtifactHash = fixture.adoption.plan.planSchemaArtifactHash;
        capability.policyHash = fixture.adoption.plan.policyHash;
        capability.stateVerifier = address(fixture.stateVerifier);
        capability.stateVerifierRuntimeCodeHash = address(fixture.stateVerifier).codehash;
        capability.stateSchemaHash = keccak256("compat-state-schema-v1");
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
