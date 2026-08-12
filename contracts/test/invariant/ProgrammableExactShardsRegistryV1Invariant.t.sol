// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { ProgrammableExactShardsFeePolicyVerifierV1 } from "../../src/ProgrammableExactShardsFeePolicyVerifierV1.sol";
import { ProgrammableExactShardsRegistryV1 } from "../../src/ProgrammableExactShardsRegistryV1.sol";
import {
    ProgrammableGithubRepositoryLineageRegistryV1
} from "../../src/ProgrammableGithubRepositoryLineageRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "../../src/interfaces/IProgrammableCustomRegistryV1.sol";
import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "../../src/interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";
import { IProgrammableExactShardsRegistryV1 } from "../../src/interfaces/IProgrammableExactShardsRegistryV1.sol";
import { ProgrammableExactShardsBindingHarnessV1 } from "../utils/ProgrammableExactShardsBindingHarnessV1.sol";

contract ExactShardsRegistryInvariantRuntimeV1 {
    function version() external pure returns (uint256) {
        return 1;
    }
}

contract ExactShardsRegistryInvariantApprovalActorV1 {
    ProgrammableExactShardsRegistryV1 public immutable registry;

    constructor(ProgrammableExactShardsRegistryV1 registry_) {
        registry = registry_;
    }

    function authorize(IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 calldata authorization) external {
        registry.authorizeApproval(authorization);
    }

    function authorizeLaunchIntent(IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 calldata authorization)
        external
    {
        registry.authorizeLaunchIntent(authorization);
    }
}

contract ProgrammableExactShardsRegistryV1InvariantHandler is Test {
    struct Record {
        bytes32 label;
        bytes32 launchId;
        bytes32 approvalId;
        bytes32 deploymentId;
        uint64 githubRepositoryId;
        bytes32 repositoryKey;
        bytes32 feePolicyRecordHash;
        bytes32 claimSetHash;
        bytes32 builderClaimHash;
        bytes32 programmableClaimHash;
        bytes32 holderClaimHash;
        uint64 latestRevision;
        bytes32 latestRecordHash;
        bool finalized;
        bool revoked;
    }

    uint256 private constant MAX_RECORDS = 16;

    ProgrammableExactShardsRegistryV1 public immutable registry;
    ProgrammableExactShardsFeePolicyVerifierV1 public immutable verifier;
    ProgrammableGithubRepositoryLineageRegistryV1 public immutable lineageRegistry;
    ProgrammableExactShardsBindingHarnessV1 public immutable bindingHarness;
    ExactShardsRegistryInvariantApprovalActorV1 public immutable approvalActor;
    ExactShardsRegistryInvariantRuntimeV1 public immutable runtimeTarget;

    Record[] private records;
    uint256 public sequence;
    uint64 public successfulRegistrations;
    uint64 public successfulFinalizations;
    uint64 public successfulCorrections;
    uint64 public successfulRevocations;
    bool public replaySucceeded;
    bool public revokedLaunchRevived;

    constructor(
        ProgrammableExactShardsRegistryV1 registry_,
        ProgrammableExactShardsFeePolicyVerifierV1 verifier_,
        ProgrammableGithubRepositoryLineageRegistryV1 lineageRegistry_,
        ProgrammableExactShardsBindingHarnessV1 bindingHarness_,
        ExactShardsRegistryInvariantApprovalActorV1 approvalActor_,
        ExactShardsRegistryInvariantRuntimeV1 runtimeTarget_
    ) {
        registry = registry_;
        verifier = verifier_;
        lineageRegistry = lineageRegistry_;
        bindingHarness = bindingHarness_;
        approvalActor = approvalActor_;
        runtimeTarget = runtimeTarget_;
    }

    function register(uint256 entropy) external {
        if (records.length >= MAX_RECORDS) return;
        bytes32 label = keccak256(abi.encode("exact-shards-registry-invariant", ++sequence, entropy));
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration = _registration(label);
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory technicalAuthorization =
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: block.chainid,
                registryGeneration: registry.REGISTRY_GENERATION(),
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: registration.approvalBindingHash,
                validAfterBlock: uint64(block.number),
                expiresAtBlock: type(uint64).max,
                evidenceHash: _field(label, "approval-evidence")
            });
        approvalActor.authorize(technicalAuthorization);
        approvalActor.authorizeLaunchIntent(
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: block.chainid,
                registryGeneration: registry.REGISTRY_GENERATION(),
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: _launchIntentBinding(registration),
                validAfterBlock: uint64(block.number),
                expiresAtBlock: uint64(block.number + 200),
                evidenceHash: _field(label, "launch-intent-evidence")
            })
        );
        lineageRegistry.consume(
            registration.githubRepositoryId,
            registration.launchId,
            keccak256("programmable.exact-shards.atomic-launch-route.v1")
        );
        registry.registerLaunch(registration);

        IProgrammableExactShardsRegistryV1.StoredFeePolicyV1 memory storedPolicy =
            registry.feePolicyState(registration.launchId);
        records.push(
            Record({
                label: label,
                launchId: registration.launchId,
                approvalId: registration.approvalId,
                deploymentId: registration.deploymentId,
                githubRepositoryId: registration.githubRepositoryId,
                repositoryKey: lineageRegistry.computeRepositoryKey(registration.githubRepositoryId),
                feePolicyRecordHash: storedPolicy.feePolicyRecordHash,
                claimSetHash: storedPolicy.claimSetHash,
                builderClaimHash: registry.feeClaim(registration.launchId, 0).storedClaimHash,
                programmableClaimHash: registry.feeClaim(registration.launchId, 1).storedClaimHash,
                holderClaimHash: registry.feeClaim(registration.launchId, 2).storedClaimHash,
                latestRevision: 1,
                latestRecordHash: registration.registeredRecordCommitment,
                finalized: false,
                revoked: false
            })
        );
        successfulRegistrations += 1;
    }

    function finalize(uint256 rawIndex) external {
        if (records.length == 0) return;
        Record storage record = records[rawIndex % records.length];
        if (record.finalized || record.revoked) return;
        IProgrammableExactShardsRegistryV1.LaunchStateV1 memory state = registry.launchState(record.launchId);
        uint64 confirmedHead = state.observedAtBlock + registry.MINIMUM_FINALITY_BLOCKS();
        if (block.number <= confirmedHead) vm.roll(uint256(confirmedHead) + 1);
        bytes32 observedHash = _field(record.label, "observed-block");
        bytes32 confirmedHash = _field(record.label, "confirmed-block");
        vm.setBlockhash(state.observedAtBlock, observedHash);
        vm.setBlockhash(confirmedHead, confirmedHash);
        registry.finalizeLaunch(
            IProgrammableCustomRegistryV1.FinalityProofV1({
                chainId: block.chainid,
                registryGeneration: registry.REGISTRY_GENERATION(),
                launchId: record.launchId,
                observedBlockNumber: state.observedAtBlock,
                observedBlockHash: observedHash,
                observedTransactionHash: _field(record.label, "observed-transaction"),
                observedTransactionIndex: 1,
                observedLogIndex: 2,
                confirmedHeadBlockNumber: confirmedHead,
                confirmedHeadBlockHash: confirmedHash,
                finalityPolicyHash: _field(record.label, "finality-policy"),
                finalityEvidenceHash: _field(record.label, "finality-evidence")
            })
        );
        record.finalized = true;
        successfulFinalizations += 1;
    }

    function correct(uint256 rawIndex, uint256 entropy) external {
        if (records.length == 0) return;
        Record storage record = records[rawIndex % records.length];
        if (!record.finalized || record.revoked) return;
        uint64 revision = record.latestRevision + 1;
        bytes32 correctedHash = keccak256(abi.encode(record.label, "corrected-record", revision, entropy));
        registry.correctLaunchRecord(
            IProgrammableCustomRegistryV1.RecordCorrectionV1({
                chainId: block.chainid,
                registryGeneration: registry.REGISTRY_GENERATION(),
                launchId: record.launchId,
                revision: revision,
                previousRecordHash: record.latestRecordHash,
                correctedRecordHash: correctedHash,
                reasonCode: keccak256(abi.encode(record.label, "correction-reason", revision)),
                evidenceHash: keccak256(abi.encode(record.label, "correction-evidence", revision))
            })
        );
        record.latestRevision = revision;
        record.latestRecordHash = correctedHash;
        successfulCorrections += 1;
    }

    function revoke(uint256 rawIndex) external {
        if (records.length == 0) return;
        Record storage record = records[rawIndex % records.length];
        if (record.revoked) return;
        registry.revokeLaunch(
            IProgrammableCustomRegistryV1.LaunchRevocationV1({
                chainId: block.chainid,
                registryGeneration: registry.REGISTRY_GENERATION(),
                launchId: record.launchId,
                reasonCode: _field(record.label, "revocation-reason"),
                evidenceHash: _field(record.label, "revocation-evidence")
            })
        );
        record.revoked = true;
        successfulRevocations += 1;
    }

    function replay(uint256 rawIndex) external {
        if (records.length == 0) return;
        Record storage record = records[rawIndex % records.length];
        uint64 registrationsBefore = registry.registrationCount();
        uint64 transitionsBefore = registry.transitionCount();
        try registry.registerLaunch(_boundRegistration(record.label)) {
            if (registry.registrationCount() != registrationsBefore || registry.transitionCount() != transitionsBefore)
            {
                replaySucceeded = true;
            }
        } catch { }
    }

    function attemptRevive(uint256 rawIndex) external {
        if (records.length == 0) return;
        Record storage record = records[rawIndex % records.length];
        if (!record.revoked) return;
        try registry.registerLaunch(_boundRegistration(record.label)) {
            if (registry.launchState(record.launchId).status != IProgrammableCustomRegistryV1.LaunchStatus.Revoked) {
                revokedLaunchRevived = true;
            }
        } catch { }
    }

    function recordCount() external view returns (uint256) {
        return records.length;
    }

    function recordAt(uint256 index) external view returns (Record memory) {
        return records[index];
    }

    function _boundRegistration(bytes32 label)
        private
        view
        returns (IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
    {
        return _registration(label);
    }

    function _registration(bytes32 label)
        private
        view
        returns (IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration.chainId = block.chainid;
        registration.registryGeneration = registry.REGISTRY_GENERATION();
        registration.launchId = _field(label, "launch-id");
        registration.projectId = _field(label, "project-id");
        registration.approvalId = _field(label, "approval-id");
        registration.githubRepositoryId = uint64(uint256(label));
        if (registration.githubRepositoryId == 0) registration.githubRepositoryId = 1;
        registration.commitId = bytes32(bytes20(hex"91b38f3de64d96cac7e29f127c004f128fc1da59"));
        registration.sourceCommitment = verifier.SOURCE_REVISION_HASH();
        registration.buildCommitment = verifier.NESTED_FACTORY_ARTIFACT_SHA256();
        registration.artifactSetHash = _field(label, "artifact-set");
        registration.deploymentConfigurationHash = _field(label, "deployment-configuration");
        registration.configurationHash = _field(label, "configuration");
        registration.tokenNameHash = keccak256(bytes("Shards"));
        registration.tokenSymbolHash = keccak256(bytes("SHARDS"));
        registration.presentationBindingHash = _field(label, "description-image-links");
        registration.permissionsHash = _field(label, "permissions");
        registration.deploymentId = _field(label, "deployment-id");
        registration.deploymentSetHash = _field(label, "deployment-set");
        registration.runtimeCodeSetHash = _field(label, "runtime-code-set");
        registration.primaryContract = address(runtimeTarget);
        registration.primaryRuntimeCodeHash = address(runtimeTarget).codehash;
        registration.launchWallet = address(this);
        registration.modelId = keccak256("programmable.exact-shards.v1");
        registration.modelVersion = keccak256("1");
        registration.templateId = keccak256("programmable.exact-shards.nested-factory.v1");
        registration.templateVersion = keccak256("1");
        registration.builderAttributionHash = _field(label, "builder");
        registration.originHash = _field(label, "origin");
        registration.assetSetHash = _field(label, "assets");
        registration.marketSetHash = _field(label, "markets");
        registration.marketPathId = verifier.PROFILE_KEY();
        registration.capabilitySetHash = _field(label, "capabilities");
        registration.reviewPolicyHash = keccak256("programmable-shards-review-policy-v1");
        registration.securityReviewHash = _field(label, "security-review");
        registration.reviewResultId = _field(label, "review-result");
        registration.finalityPolicyHash = _field(label, "finality-policy");
        registration.feePolicy.profileKey = verifier.PROFILE_KEY();
        registration.feePolicy.feeAsset = verifier.FEE_ASSET();
        registration.feePolicy.feeBasisHash = verifier.FEE_BASIS_HASH();
        registration.feePolicy.totalFeeBps = verifier.TOTAL_FEE_BPS();
        registration.feePolicy.legsHash = verifier.LEGS_HASH();
        registration.orderedFeeLegs[0] = IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1({
            roleHash: verifier.BUILDER_ROLE_HASH(),
            feeBps: verifier.BUILDER_FEE_BPS(),
            recipient: verifier.INITIAL_BUILDER_RECIPIENT(),
            recipientModeHash: verifier.BUILDER_RECIPIENT_MODE_HASH()
        });
        registration.orderedFeeLegs[1] = IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1({
            roleHash: verifier.PROGRAMMABLE_ROLE_HASH(),
            feeBps: verifier.PROGRAMMABLE_FEE_BPS(),
            recipient: verifier.PROGRAMMABLE_RECIPIENT(),
            recipientModeHash: verifier.PROGRAMMABLE_RECIPIENT_MODE_HASH()
        });
        registration.orderedFeeLegs[2] = IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1({
            roleHash: verifier.HOLDER_ROLE_HASH(),
            feeBps: verifier.HOLDER_FEE_BPS(),
            recipient: verifier.HOLDER_ACCUMULATOR(),
            recipientModeHash: verifier.HOLDER_RECIPIENT_MODE_HASH()
        });
        (registration.approvalBindingHash,,,) = bindingHarness.computeBindings(registration);
        (,, registration.reviewDeploymentBindingHash,) = bindingHarness.computeBindings(registration);
        (,,, registration.registeredRecordCommitment) = bindingHarness.computeBindings(registration);
    }

    function _launchIntentBinding(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (bytes32 bindingHash)
    {
        (, bindingHash,,) = bindingHarness.computeBindings(registration);
    }

    function _field(bytes32 label, string memory field) private pure returns (bytes32) {
        return keccak256(abi.encode(label, field));
    }
}

contract ProgrammableExactShardsRegistryV1InvariantTest is StdInvariant, Test {
    ProgrammableExactShardsRegistryV1 internal registry;
    ProgrammableGithubRepositoryLineageRegistryV1 internal lineageRegistry;
    ProgrammableExactShardsRegistryV1InvariantHandler internal handler;

    uint64 private lastRegistrationCount;
    uint64 private lastTransitionCount;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        ProgrammableExactShardsFeePolicyVerifierV1 verifier = new ProgrammableExactShardsFeePolicyVerifierV1();
        lineageRegistry = new ProgrammableGithubRepositoryLineageRegistryV1(2 days, address(this));
        ExactShardsRegistryInvariantRuntimeV1 runtimeTarget = new ExactShardsRegistryInvariantRuntimeV1();
        registry = new ProgrammableExactShardsRegistryV1(
            ProgrammableExactShardsRegistryV1.RegistryConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: address(this),
                initialApprover: address(0xA990),
                initialWriter: address(0xB001),
                initialFinalizer: address(this),
                initialCorrector: address(this),
                initialRevoker: address(this),
                registryGeneration: 3,
                minimumFinalityBlocks: 3,
                chainProfileHash: keccak256("ethereum-mainnet-chain-profile"),
                registryPolicyHash: keccak256("exact-shards-registry-policy")
            }),
            verifier,
            lineageRegistry
        );
        ExactShardsRegistryInvariantApprovalActorV1 approvalActor =
            new ExactShardsRegistryInvariantApprovalActorV1(registry);
        ProgrammableExactShardsBindingHarnessV1 bindingHarness =
            new ProgrammableExactShardsBindingHarnessV1(registry, verifier, lineageRegistry);
        registry.grantRole(registry.APPROVER_ROLE(), address(approvalActor));
        registry.revokeRole(registry.APPROVER_ROLE(), address(0xA990));
        handler = new ProgrammableExactShardsRegistryV1InvariantHandler(
            registry, verifier, lineageRegistry, bindingHarness, approvalActor, runtimeTarget
        );
        registry.grantRole(registry.WRITER_ROLE(), address(handler));
        lineageRegistry.grantRole(lineageRegistry.CONSUMER_ROLE(), address(handler));
        registry.revokeRole(registry.WRITER_ROLE(), address(0xB001));
        registry.grantRole(registry.FINALIZER_ROLE(), address(handler));
        registry.grantRole(registry.CORRECTOR_ROLE(), address(handler));
        registry.grantRole(registry.REVOKER_ROLE(), address(handler));

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.register.selector;
        selectors[1] = handler.finalize.selector;
        selectors[2] = handler.correct.selector;
        selectors[3] = handler.revoke.selector;
        selectors[4] = handler.replay.selector;
        selectors[5] = handler.attemptRevive.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_countsAreMonotonicAndMatchSuccessfulTransitions() public {
        uint64 registrations = registry.registrationCount();
        uint64 transitions = registry.transitionCount();
        assertGe(registrations, lastRegistrationCount);
        assertGe(transitions, lastTransitionCount);
        assertEq(registrations, handler.successfulRegistrations());
        assertEq(
            transitions,
            handler.successfulRegistrations() * 3 + handler.successfulFinalizations() + handler.successfulCorrections()
                + handler.successfulRevocations()
        );
        lastRegistrationCount = registrations;
        lastTransitionCount = transitions;
    }

    function invariant_feePolicyAndThreeClaimsRemainImmutable() public view {
        uint256 count = handler.recordCount();
        for (uint256 index; index < count; ++index) {
            ProgrammableExactShardsRegistryV1InvariantHandler.Record memory record = handler.recordAt(index);
            IProgrammableExactShardsRegistryV1.StoredFeePolicyV1 memory policy =
                registry.feePolicyState(record.launchId);
            assertEq(policy.feePolicyRecordHash, record.feePolicyRecordHash);
            assertEq(policy.claimSetHash, record.claimSetHash);
            assertEq(policy.totalFeeBps, 100);
            assertEq(registry.feeClaim(record.launchId, 0).storedClaimHash, record.builderClaimHash);
            assertEq(registry.feeClaim(record.launchId, 1).storedClaimHash, record.programmableClaimHash);
            assertEq(registry.feeClaim(record.launchId, 2).storedClaimHash, record.holderClaimHash);
            assertEq(registry.feeClaim(record.launchId, 0).shareOfFeeBps, 1000);
            assertEq(registry.feeClaim(record.launchId, 1).shareOfFeeBps, 1000);
            assertEq(registry.feeClaim(record.launchId, 2).shareOfFeeBps, 8000);
        }
    }

    function invariant_approvalDeploymentAndRevisionAreOneUseBound() public view {
        uint256 count = handler.recordCount();
        for (uint256 index; index < count; ++index) {
            ProgrammableExactShardsRegistryV1InvariantHandler.Record memory record = handler.recordAt(index);
            IProgrammableExactShardsRegistryV1.LaunchStateV1 memory state = registry.launchState(record.launchId);
            assertTrue(registry.approvalConsumed(record.approvalId));
            assertTrue(registry.approvalState(record.approvalId).consumed);
            assertTrue(registry.deploymentConsumed(record.deploymentId));
            assertEq(lineageRegistry.consumption(record.repositoryKey).launchId, record.launchId);
            assertEq(lineageRegistry.computeRepositoryKey(record.githubRepositoryId), record.repositoryKey);
            assertEq(state.latestRecordRevision, record.latestRevision);
            assertEq(state.latestRecordHash, record.latestRecordHash);
            assertEq(registry.recordHashAtRevision(record.launchId, record.latestRevision), record.latestRecordHash);
        }
        assertFalse(handler.replaySucceeded());
    }

    function invariant_revocationIsTerminal() public view {
        uint256 count = handler.recordCount();
        for (uint256 index; index < count; ++index) {
            ProgrammableExactShardsRegistryV1InvariantHandler.Record memory record = handler.recordAt(index);
            IProgrammableCustomRegistryV1.LaunchStatus expected;
            if (record.revoked) expected = IProgrammableCustomRegistryV1.LaunchStatus.Revoked;
            else if (record.finalized) expected = IProgrammableCustomRegistryV1.LaunchStatus.Finalized;
            else expected = IProgrammableCustomRegistryV1.LaunchStatus.Observed;
            assertEq(uint8(registry.launchState(record.launchId).status), uint8(expected));
        }
        assertFalse(handler.revokedLaunchRevived());
    }
}
