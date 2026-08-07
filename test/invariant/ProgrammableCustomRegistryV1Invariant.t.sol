// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { ProgrammableCustomFeePolicyVerifierV1 } from "../../src/ProgrammableCustomFeePolicyVerifierV1.sol";
import { ProgrammableCustomPartnerFactoryRegistryV1 } from "../../src/ProgrammableCustomPartnerFactoryRegistryV1.sol";
import { ProgrammableCustomRegistryV1 } from "../../src/ProgrammableCustomRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "../../src/interfaces/IProgrammableCustomRegistryV1.sol";

contract RegistryInvariantRuntimeTargetV1 {
    function version() external pure returns (uint256) {
        return 1;
    }
}

contract RegistryInvariantApprovalActorV1 {
    ProgrammableCustomRegistryV1 public immutable registry;

    constructor(ProgrammableCustomRegistryV1 registry_) {
        registry = registry_;
    }

    function authorize(IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 calldata authorization) external {
        registry.authorizeApproval(authorization);
    }
}

contract ProgrammableCustomRegistryV1InvariantHandler {
    struct Record {
        bytes32 label;
        bytes32 launchId;
        bytes32 approvalId;
        bytes32 deploymentId;
        bytes32 registeredRecordCommitment;
        bool revoked;
    }

    uint256 private constant MAX_RECORDS = 24;
    bytes32 private constant PUBLIC_NO_MARKET_POLICY_BINDING =
        0x6ce49c7599693b5ff58a3c3d3858a2f2866a966d98cd0c06edb4f70a39e4bbaa;

    ProgrammableCustomRegistryV1 public immutable registry;
    RegistryInvariantApprovalActorV1 public immutable approvalActor;
    RegistryInvariantRuntimeTargetV1 public immutable runtimeTarget;

    Record[] private records;
    uint256 public sequence;
    uint64 public successfulRegistrations;
    uint64 public successfulRevocations;
    bool public replaySucceeded;
    bool public revokedLaunchRevived;

    constructor(
        ProgrammableCustomRegistryV1 registry_,
        RegistryInvariantApprovalActorV1 approvalActor_,
        RegistryInvariantRuntimeTargetV1 runtimeTarget_
    ) {
        registry = registry_;
        approvalActor = approvalActor_;
        runtimeTarget = runtimeTarget_;
    }

    function register(uint256 entropy) external {
        if (records.length >= MAX_RECORDS) return;
        bytes32 label = keccak256(abi.encode("registry-invariant", ++sequence, entropy));
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _registration(label);
        bytes32 feePolicyHash = registry.computeFeePolicyHash(registration.feePolicy);
        registration.approvalBindingHash = registry.computeApprovalBindingHash(registration, feePolicyHash);
        registration.reviewDeploymentBindingHash =
            registry.computeReviewDeploymentBindingHash(registration, feePolicyHash);
        registration.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(registration, feePolicyHash);

        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory authorization =
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: block.chainid,
                registryGeneration: registry.REGISTRY_GENERATION(),
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: registry.computeRegistrationBindingHash(registration, feePolicyHash),
                validAfterBlock: uint64(block.number),
                expiresAtBlock: uint64(block.number + 10_000),
                evidenceHash: _field(label, "approval-evidence")
            });
        approvalActor.authorize(authorization);
        registry.registerLaunch(registration);

        records.push(
            Record({
                label: label,
                launchId: registration.launchId,
                approvalId: registration.approvalId,
                deploymentId: registration.deploymentId,
                registeredRecordCommitment: registration.registeredRecordCommitment,
                revoked: false
            })
        );
        successfulRegistrations += 1;
    }

    function replay(uint256 rawIndex) external {
        if (records.length == 0) return;
        Record storage record = records[rawIndex % records.length];
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _boundRegistration(record.label);
        try registry.registerLaunch(registration) {
            replaySucceeded = true;
        } catch { }
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

    function attemptRevive(uint256 rawIndex) external {
        if (records.length == 0) return;
        Record storage record = records[rawIndex % records.length];
        if (!record.revoked) return;
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _boundRegistration(record.label);
        try registry.registerLaunch(registration) {
            revokedLaunchRevived = true;
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
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration = _registration(label);
        bytes32 feePolicyHash = registry.computeFeePolicyHash(registration.feePolicy);
        registration.approvalBindingHash = registry.computeApprovalBindingHash(registration, feePolicyHash);
        registration.reviewDeploymentBindingHash =
            registry.computeReviewDeploymentBindingHash(registration, feePolicyHash);
        registration.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(registration, feePolicyHash);
    }

    function _registration(bytes32 label)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration.chainId = block.chainid;
        registration.registryGeneration = registry.REGISTRY_GENERATION();
        registration.launchId = _field(label, "launch-id");
        registration.projectId = _field(label, "project-id");
        registration.approvalId = _field(label, "approval-id");
        registration.repositoryId = _field(label, "repository-id");
        registration.commitId = _field(label, "commit-id");
        registration.sourceCommitment = _field(label, "source-commitment");
        registration.buildCommitment = _field(label, "build-commitment");
        registration.artifactSetHash = _field(label, "artifact-set");
        registration.deploymentConfigurationHash = _field(label, "deployment-configuration");
        registration.configurationHash = _field(label, "configuration");
        registration.permissionsHash = _field(label, "permissions");
        registration.deploymentId = _field(label, "deployment-id");
        registration.deploymentSetHash = _field(label, "deployment-set");
        registration.runtimeCodeSetHash = _field(label, "runtime-code-set");
        registration.primaryContract = address(runtimeTarget);
        registration.primaryRuntimeCodeHash = address(runtimeTarget).codehash;
        registration.launchWallet = address(this);
        registration.modelId = keccak256("programmable.custom-model.invariant.v1");
        registration.modelVersion = keccak256("1");
        registration.builderAttributionHash = _field(label, "builder-attribution");
        registration.originHash = _field(label, "origin");
        registration.assetSetHash = _field(label, "asset-set");
        registration.marketSetHash = _field(label, "market-set");
        registration.capabilitySetHash = _field(label, "capability-set");
        registration.reviewPolicyHash = keccak256("programmable.security-policy.invariant.v1");
        registration.securityReviewHash = _field(label, "security-review");
        registration.reviewResultId = _field(label, "review-result");
        registration.finalityPolicyHash = keccak256("programmable.finality-policy.invariant.v1");
        registration.feePolicy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NoQualifyingMarket;
        registration.feePolicy.publicPolicyBindingHash = PUBLIC_NO_MARKET_POLICY_BINDING;
        registration.feePolicy.claimIsolationEvidenceHash =
        0x303e820706c10bce1cf7cec787adec9a2985c363d325c397243c2d757a96a6f8;
        registration.feePolicy.accountingSafetyEvidenceHash =
        0xd0aa31a74060c406089ac5a97522b9d19872ec6d5e5383af86c8634340192bde;
        registration.feePolicy.verificationEvidenceHash =
        0x3e1c94a30db033439e3293ee180583ee824c51d0130c00249e6cf5ca2b149fa3;
    }

    function _field(bytes32 label, string memory field) private pure returns (bytes32) {
        return keccak256(abi.encode(label, field));
    }
}

contract ProgrammableCustomRegistryV1InvariantTest is StdInvariant, Test {
    ProgrammableCustomRegistryV1 internal registry;
    ProgrammableCustomRegistryV1InvariantHandler internal handler;

    uint64 private lastRegistrationCount;
    uint64 private lastApprovalCount;
    uint64 private lastTransitionCount;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        RegistryInvariantRuntimeTargetV1 runtimeTarget = new RegistryInvariantRuntimeTargetV1();
        ProgrammableCustomPartnerFactoryRegistryV1 partnerFactoryRegistry = new ProgrammableCustomPartnerFactoryRegistryV1(
            2 days, address(this), address(0xA990), address(0xDEAD), 1
        );
        ProgrammableCustomFeePolicyVerifierV1 feePolicyVerifier = new ProgrammableCustomFeePolicyVerifierV1();
        RegistryInvariantApprovalActorV1 approvalActor;
        registry = new ProgrammableCustomRegistryV1(
            ProgrammableCustomRegistryV1.RegistryConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: address(this),
                initialApprover: address(0xA990),
                initialWriter: address(0xB001),
                initialFinalizer: address(this),
                initialCorrector: address(this),
                initialRevoker: address(this),
                registryGeneration: 1,
                minimumFinalityBlocks: 3,
                chainProfileHash: keccak256("ethereum-mainnet-chain-profile"),
                registryPolicyHash: keccak256("registry-policy")
            }),
            partnerFactoryRegistry,
            feePolicyVerifier
        );
        approvalActor = new RegistryInvariantApprovalActorV1(registry);
        registry.grantRole(registry.APPROVER_ROLE(), address(approvalActor));
        registry.revokeRole(registry.APPROVER_ROLE(), address(0xA990));
        handler = new ProgrammableCustomRegistryV1InvariantHandler(registry, approvalActor, runtimeTarget);
        registry.grantRole(registry.WRITER_ROLE(), address(handler));
        registry.grantRole(registry.REVOKER_ROLE(), address(handler));

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.register.selector;
        selectors[1] = handler.replay.selector;
        selectors[2] = handler.revoke.selector;
        selectors[3] = handler.attemptRevive.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_countsAreMonotonicAndMatchSuccessfulTransitions() public {
        uint64 registrations = registry.registrationCount();
        uint64 approvals = registry.approvalAuthorizationCount();
        uint64 transitions = registry.transitionCount();
        assertGe(registrations, lastRegistrationCount);
        assertGe(approvals, lastApprovalCount);
        assertGe(transitions, lastTransitionCount);
        assertEq(registrations, handler.successfulRegistrations());
        assertEq(approvals, handler.successfulRegistrations());
        assertEq(transitions, handler.successfulRegistrations() * 2 + handler.successfulRevocations());
        lastRegistrationCount = registrations;
        lastApprovalCount = approvals;
        lastTransitionCount = transitions;
    }

    function invariant_approvalDeploymentAndRecordAreOneUseBound() public view {
        uint256 count = handler.recordCount();
        for (uint256 index; index < count; ++index) {
            ProgrammableCustomRegistryV1InvariantHandler.Record memory record = handler.recordAt(index);
            IProgrammableCustomRegistryV1.LaunchStateV1 memory state = registry.launchState(record.launchId);
            IProgrammableCustomRegistryV1.LaunchDetailsV1 memory details = registry.launchDetails(record.launchId);
            assertTrue(registry.approvalConsumed(record.approvalId));
            assertTrue(registry.approvalState(record.approvalId).consumed);
            assertTrue(registry.deploymentConsumed(record.deploymentId));
            assertEq(details.approvalId, record.approvalId);
            assertEq(details.deploymentId, record.deploymentId);
            assertEq(state.latestRecordRevision, 1);
            assertEq(state.latestRecordHash, record.registeredRecordCommitment);
            assertEq(registry.recordHashAtRevision(record.launchId, 1), record.registeredRecordCommitment);
        }
        assertFalse(handler.replaySucceeded());
    }

    function invariant_revocationIsTerminal() public view {
        uint256 count = handler.recordCount();
        for (uint256 index; index < count; ++index) {
            ProgrammableCustomRegistryV1InvariantHandler.Record memory record = handler.recordAt(index);
            IProgrammableCustomRegistryV1.LaunchStatus expected = record.revoked
                ? IProgrammableCustomRegistryV1.LaunchStatus.Revoked
                : IProgrammableCustomRegistryV1.LaunchStatus.Observed;
            assertEq(uint8(registry.launchState(record.launchId).status), uint8(expected));
        }
        assertFalse(handler.revokedLaunchRevived());
    }
}
