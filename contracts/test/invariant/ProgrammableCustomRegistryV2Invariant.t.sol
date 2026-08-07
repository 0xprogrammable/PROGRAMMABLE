// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { ProgrammableCustomFeePolicyVerifierV2 } from "../../src/ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "../../src/ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "../../src/ProgrammableCustomRegistryV1.sol";
import { ProgrammableCustomRegistryV2 } from "../../src/ProgrammableCustomRegistryV2.sol";
import { IProgrammableCustomRegistryV1 } from "../../src/interfaces/IProgrammableCustomRegistryV1.sol";

contract RegistryInvariantRuntimeTargetV2 {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract RegistryInvariantApprovalActorV2 {
    ProgrammableCustomRegistryV2 public immutable registry;

    constructor(ProgrammableCustomRegistryV2 registry_) {
        registry = registry_;
    }

    function authorize(IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 calldata authorization) external {
        registry.authorizeApproval(authorization);
    }
}

contract ProgrammableCustomRegistryV2InvariantHandler {
    struct Record {
        bytes32 label;
        bytes32 launchId;
        bytes32 approvalId;
        bytes32 deploymentId;
        bytes32 recordCommitment;
        bool revoked;
    }

    uint256 private constant MAX_RECORDS = 24;

    ProgrammableCustomRegistryV2 public immutable registry;
    RegistryInvariantApprovalActorV2 public immutable approvalActor;
    RegistryInvariantRuntimeTargetV2 public immutable runtimeTarget;

    Record[] private records;
    uint256 public sequence;
    uint64 public successfulRegistrations;
    uint64 public successfulRevocations;
    bool public replaySucceeded;
    bool public revokedLaunchRevived;
    bool public crossGenerationSucceeded;

    constructor(
        ProgrammableCustomRegistryV2 registry_,
        RegistryInvariantApprovalActorV2 approvalActor_,
        RegistryInvariantRuntimeTargetV2 runtimeTarget_
    ) {
        registry = registry_;
        approvalActor = approvalActor_;
        runtimeTarget = runtimeTarget_;
    }

    function register(uint256 entropy) external {
        if (records.length >= MAX_RECORDS) return;
        bytes32 label = keccak256(abi.encode("registry-v2-invariant", ++sequence, entropy));
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _boundRegistration(label, 2);
        approvalActor.authorize(_authorization(registration));
        registry.registerLaunch(registration);
        records.push(
            Record({
                label: label,
                launchId: registration.launchId,
                approvalId: registration.approvalId,
                deploymentId: registration.deploymentId,
                recordCommitment: registration.registeredRecordCommitment,
                revoked: false
            })
        );
        successfulRegistrations += 1;
    }

    function replay(uint256 rawIndex) external {
        if (records.length == 0) return;
        Record storage record = records[rawIndex % records.length];
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _boundRegistration(record.label, 2);
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
                registryGeneration: 2,
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
        try registry.registerLaunch(_boundRegistration(record.label, 2)) {
            revokedLaunchRevived = true;
        } catch { }
    }

    function attemptCrossGeneration(uint256 entropy) external {
        bytes32 label = keccak256(abi.encode("cross-generation", entropy));
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _boundRegistration(label, 1);
        try approvalActor.authorize(_authorization(registration)) {
            crossGenerationSucceeded = true;
        } catch { }
    }

    function recordCount() external view returns (uint256) {
        return records.length;
    }

    function recordAt(uint256 index) external view returns (Record memory) {
        return records[index];
    }

    function _authorization(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory)
    {
        bytes32 feePolicyHash = registry.computeFeePolicyHash(registration.feePolicy);
        return IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
            chainId: registration.chainId,
            registryGeneration: registration.registryGeneration,
            approvalId: registration.approvalId,
            launchId: registration.launchId,
            approvalBindingHash: registration.approvalBindingHash,
            registrationBindingHash: registry.computeRegistrationBindingHash(registration, feePolicyHash),
            validAfterBlock: uint64(block.number),
            expiresAtBlock: uint64(block.number + 10_000),
            evidenceHash: _field(registration.launchId, "approval-evidence")
        });
    }

    function _boundRegistration(bytes32 label, uint64 generation)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration = _registration(label, generation);
        bytes32 feePolicyHash = registry.computeFeePolicyHash(registration.feePolicy);
        registration.approvalBindingHash = registry.computeApprovalBindingHash(registration, feePolicyHash);
        registration.reviewDeploymentBindingHash =
            registry.computeReviewDeploymentBindingHash(registration, feePolicyHash);
        registration.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(registration, feePolicyHash);
    }

    function _registration(bytes32 label, uint64 generation)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration.chainId = block.chainid;
        registration.registryGeneration = generation;
        registration.launchId = _field(label, "launch-id");
        registration.projectId = _field(label, "project-id");
        registration.approvalId = _field(label, "approval-id");
        registration.repositoryId = _field(label, "repository-id");
        registration.commitId = _field(label, "commit-id");
        registration.sourceCommitment = _field(label, "source");
        registration.buildCommitment = _field(label, "build");
        registration.artifactSetHash = _field(label, "artifacts");
        registration.deploymentConfigurationHash = _field(label, "deployment-config");
        registration.configurationHash = _field(label, "configuration");
        registration.permissionsHash = _field(label, "permissions");
        registration.deploymentId = _field(label, "deployment-id");
        registration.deploymentSetHash = _field(label, "deployment-set");
        registration.runtimeCodeSetHash = _field(label, "runtime-set");
        registration.primaryContract = address(runtimeTarget);
        registration.primaryRuntimeCodeHash = address(runtimeTarget).codehash;
        registration.launchWallet = address(this);
        registration.modelId = keccak256("programmable.custom-model.invariant.v2");
        registration.modelVersion = keccak256("2");
        registration.templateId = _field(label, "template-id");
        registration.templateVersion = keccak256("2");
        registration.builderAttributionHash = _field(label, "builder");
        registration.originHash = _field(label, "origin");
        registration.assetSetHash = _field(label, "assets");
        registration.marketSetHash = _field(label, "markets");
        registration.marketPathId = _field(label, "market-path");
        registration.capabilitySetHash = _field(label, "capabilities");
        registration.reviewPolicyHash = keccak256("programmable.security-policy.invariant.v2");
        registration.securityReviewHash = _field(label, "security-review");
        registration.reviewResultId = _field(label, "review-result");
        registration.finalityPolicyHash = keccak256("programmable.finality-policy.invariant.v2");

        registration.feePolicy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NativeCustom;
        registration.feePolicy.modelId = registration.modelId;
        registration.feePolicy.modelVersion = registration.modelVersion;
        registration.feePolicy.templateId = registration.templateId;
        registration.feePolicy.templateVersion = registration.templateVersion;
        registration.feePolicy.marketPathId = registration.marketPathId;
        registration.feePolicy.totalFeeBps = 10;
        registration.feePolicy.nativeCustomFeeBps = 10;
        registration.feePolicy.programmable = _programmableLeg(label);
        registration.feePolicy.publicPolicyBindingHash = _field(label, "fee-policy");
        registration.feePolicy.claimIsolationEvidenceHash = _field(label, "claim-isolation");
        registration.feePolicy.accountingSafetyEvidenceHash = _field(label, "accounting-safety");
        registration.feePolicy.verificationEvidenceHash = _field(label, "fee-verification");
    }

    function _programmableLeg(bytes32 label) private pure returns (IProgrammableCustomRegistryV1.FeeLegV1 memory leg) {
        leg.shareBps = 10;
        leg.recipient = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
        leg.currency = address(0xCAFE);
        leg.chargeModeId = _field(label, "charge-mode");
        leg.basisId = _field(label, "basis");
        leg.roundingId = _field(label, "rounding");
        leg.accrualId = _field(label, "accrual");
        leg.claimId = _field(label, "claim");
        leg.claimRightId = _field(label, "claim-right");
        leg.controlEvidenceHash = _field(label, "control-evidence");
    }

    function _field(bytes32 label, string memory field) private pure returns (bytes32) {
        return keccak256(abi.encode(label, field));
    }
}

contract ProgrammableCustomRegistryV2InvariantTest is StdInvariant, Test {
    ProgrammableCustomRegistryV2 internal registry;
    ProgrammableCustomRegistryV2InvariantHandler internal handler;

    uint64 private lastRegistrationCount;
    uint64 private lastApprovalCount;
    uint64 private lastTransitionCount;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        RegistryInvariantRuntimeTargetV2 runtimeTarget = new RegistryInvariantRuntimeTargetV2();
        ProgrammableCustomPartnerFactoryRegistryV2 partnerRegistry =
            new ProgrammableCustomPartnerFactoryRegistryV2(2 days, address(this), address(0xFA01), address(0xFA02));
        ProgrammableCustomFeePolicyVerifierV2 verifier = new ProgrammableCustomFeePolicyVerifierV2();
        registry = new ProgrammableCustomRegistryV2(
            ProgrammableCustomRegistryV1.RegistryConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: address(this),
                initialApprover: address(0xA990),
                initialWriter: address(this),
                initialFinalizer: address(0xF001),
                initialCorrector: address(0xC001),
                initialRevoker: address(this),
                registryGeneration: 2,
                minimumFinalityBlocks: 3,
                chainProfileHash: keccak256("ethereum-mainnet-chain-profile-v2"),
                registryPolicyHash: keccak256("registry-policy-v2")
            }),
            partnerRegistry,
            verifier
        );
        RegistryInvariantApprovalActorV2 approvalActor = new RegistryInvariantApprovalActorV2(registry);
        registry.grantRole(registry.APPROVER_ROLE(), address(approvalActor));
        registry.revokeRole(registry.APPROVER_ROLE(), address(0xA990));
        handler = new ProgrammableCustomRegistryV2InvariantHandler(registry, approvalActor, runtimeTarget);
        registry.grantRole(registry.WRITER_ROLE(), address(handler));
        registry.revokeRole(registry.WRITER_ROLE(), address(this));
        registry.grantRole(registry.REVOKER_ROLE(), address(handler));

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = handler.register.selector;
        selectors[1] = handler.replay.selector;
        selectors[2] = handler.revoke.selector;
        selectors[3] = handler.attemptRevive.selector;
        selectors[4] = handler.attemptCrossGeneration.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_generationAndCountsRemainScopedAndMonotonic() public {
        uint64 registrations = registry.registrationCount();
        uint64 approvals = registry.approvalAuthorizationCount();
        uint64 transitions = registry.transitionCount();
        assertEq(registry.REGISTRY_GENERATION(), 2);
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
            ProgrammableCustomRegistryV2InvariantHandler.Record memory record = handler.recordAt(index);
            IProgrammableCustomRegistryV1.LaunchStateV1 memory state = registry.launchState(record.launchId);
            assertTrue(registry.approvalConsumed(record.approvalId));
            assertTrue(registry.approvalState(record.approvalId).consumed);
            assertTrue(registry.deploymentConsumed(record.deploymentId));
            assertEq(state.latestRecordRevision, 1);
            assertEq(state.latestRecordHash, record.recordCommitment);
            assertEq(registry.recordHashAtRevision(record.launchId, 1), record.recordCommitment);
        }
        assertFalse(handler.replaySucceeded());
        assertFalse(handler.crossGenerationSucceeded());
    }

    function invariant_revocationIsTerminal() public view {
        uint256 count = handler.recordCount();
        for (uint256 index; index < count; ++index) {
            ProgrammableCustomRegistryV2InvariantHandler.Record memory record = handler.recordAt(index);
            IProgrammableCustomRegistryV1.LaunchStatus expected = record.revoked
                ? IProgrammableCustomRegistryV1.LaunchStatus.Revoked
                : IProgrammableCustomRegistryV1.LaunchStatus.Observed;
            assertEq(uint8(registry.launchState(record.launchId).status), uint8(expected));
        }
        assertFalse(handler.revokedLaunchRevived());
    }
}
