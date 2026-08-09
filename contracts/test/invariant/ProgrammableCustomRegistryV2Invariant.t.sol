// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { ProgrammableCustomFeePolicyVerifierV2 } from "../../src/ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomAtomicRegistrarV1 } from "../../src/ProgrammableCustomAtomicRegistrarV1.sol";
import { ProgrammableCustomAtomicRegistrarV2 } from "../../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomExecutionPolicyRegistryV2 } from "../../src/ProgrammableCustomExecutionPolicyRegistryV2.sol";
import { ProgrammableLaunchStampV1 } from "../../src/ProgrammableLaunchStampV1.sol";
import {
    ProgrammableCustomExecutionPolicyRevisionRegistryV2
} from "../../src/ProgrammableCustomExecutionPolicyRevisionRegistryV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "../../src/ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "../../src/ProgrammableCustomRegistryV1.sol";
import { ProgrammableCustomRegistryV2 } from "../../src/ProgrammableCustomRegistryV2.sol";
import { IProgrammableCustomRegistryV1 } from "../../src/interfaces/IProgrammableCustomRegistryV1.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "../../src/interfaces/IProgrammableCustomExecutionPolicyV2.sol";

contract RegistryInvariantRuntimeTargetV2 {
    uint256 public configuredValue;

    function initialize(uint256 value) external returns (bytes32 result) {
        require(configuredValue == 0, "already initialized");
        configuredValue = value;
        result = keccak256(abi.encode(value));
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
    ProgrammableCustomAtomicRegistrarV2 public immutable registrar;
    ProgrammableCustomExecutionPolicyRegistryV2 public immutable executionPolicyRegistry;

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
        RegistryInvariantRuntimeTargetV2 runtimeTarget_,
        ProgrammableCustomAtomicRegistrarV2 registrar_,
        ProgrammableCustomExecutionPolicyRegistryV2 executionPolicyRegistry_
    ) {
        registry = registry_;
        approvalActor = approvalActor_;
        runtimeTarget = runtimeTarget_;
        registrar = registrar_;
        executionPolicyRegistry = executionPolicyRegistry_;
    }

    function register(uint256 entropy) external {
        if (records.length >= MAX_RECORDS) return;
        bytes32 label = keccak256(abi.encode("registry-v2-invariant", ++sequence, entropy));
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request = _atomicRequest(label, 2);
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = request.registration;
        approvalActor.authorize(_authorization(registration));
        registrar.deployInitializeAndRegister(request);
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
        registration = _atomicRequest(label, generation).registration;
    }

    function _atomicRequest(bytes32 label, uint64 generation)
        private
        view
        returns (ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request)
    {
        uint256 configuredValue = uint256(label) | 1;
        request.salt = _field(label, "create2-salt");
        request.creationCode = type(RegistryInvariantRuntimeTargetV2).creationCode;
        request.initializationCall = abi.encodeCall(RegistryInvariantRuntimeTargetV2.initialize, (configuredValue));
        request.initializationResultHash = keccak256(abi.encode(keccak256(abi.encode(configuredValue))));
        request.registration = _registration(label, generation);
        request.registration.primaryContract = registrar.predictAddress(request.salt, keccak256(request.creationCode));
        request.registration.primaryRuntimeCodeHash = keccak256(type(RegistryInvariantRuntimeTargetV2).runtimeCode);
        request.registration.deploymentConfigurationHash = registrar.computeAtomicRequestCommitment(request);
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            registrar.unsupportedTradeCapabilityV1(request.registration);
        request.registration.capabilitySetHash = executionPolicyRegistry.computeTradeCapabilityHashV1(capability);
        bytes32 feePolicyHash = registry.computeFeePolicyHash(request.registration.feePolicy);
        request.registration.approvalBindingHash =
            registry.computeApprovalBindingHash(request.registration, feePolicyHash);
        request.registration.reviewDeploymentBindingHash =
            registry.computeReviewDeploymentBindingHash(request.registration, feePolicyHash);
        request.registration.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(request.registration, feePolicyHash);
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
        registration.configurationHash = _field(label, "configuration");
        registration.permissionsHash = _field(label, "permissions");
        registration.deploymentId = _field(label, "deployment-id");
        registration.deploymentSetHash = _field(label, "deployment-set");
        registration.runtimeCodeSetHash = _field(label, "runtime-set");
        registration.launchWallet = address(this);
        registration.modelId = keccak256("programmable.custom-model.invariant.v2");
        registration.modelVersion = keccak256("2");
        registration.templateId = _field(label, "template-id");
        registration.templateVersion = keccak256("2");
        registration.builderAttributionHash = _field(label, "builder");
        registration.originHash = _field(label, "origin");
        registration.assetSetHash = _field(label, "assets");
        registration.marketSetHash = registrar.PROJECT_ONLY_MARKET_SET_HASH();
        registration.marketPathId = bytes32(0);
        registration.reviewPolicyHash = keccak256("programmable.security-policy.invariant.v2");
        registration.securityReviewHash = _field(label, "security-review");
        registration.reviewResultId = _field(label, "review-result");
        registration.finalityPolicyHash = keccak256("programmable.finality-policy.invariant.v2");

        registration.feePolicy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NoQualifyingMarket;
        registration.feePolicy.publicPolicyBindingHash = _field(label, "fee-policy");
        registration.feePolicy.claimIsolationEvidenceHash = _field(label, "claim-isolation");
        registration.feePolicy.accountingSafetyEvidenceHash = _field(label, "accounting-safety");
        registration.feePolicy.verificationEvidenceHash = _field(label, "fee-verification");
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
        uint256 nextNonce = vm.getNonce(address(this));
        address predictedRevisionRegistry = vm.computeCreateAddress(address(this), nextNonce + 3);
        address predictedRegistry = vm.computeCreateAddress(address(this), nextNonce + 4);
        address predictedRegistrar = vm.computeCreateAddress(address(this), nextNonce + 5);
        ProgrammableCustomPartnerFactoryRegistryV2 partnerRegistry = new ProgrammableCustomPartnerFactoryRegistryV2(
            2 days, address(this), address(0xFA01), address(0xFA02), predictedRegistrar
        );
        ProgrammableCustomFeePolicyVerifierV2 verifier = new ProgrammableCustomFeePolicyVerifierV2();
        ProgrammableCustomExecutionPolicyRegistryV2 executionPolicyRegistry = new ProgrammableCustomExecutionPolicyRegistryV2(
            IProgrammableCustomRegistryV1(predictedRegistry),
            partnerRegistry,
            predictedRegistrar,
            predictedRevisionRegistry
        );
        ProgrammableCustomExecutionPolicyRevisionRegistryV2 revisionRegistry = new ProgrammableCustomExecutionPolicyRevisionRegistryV2(
            IProgrammableCustomRegistryV1(predictedRegistry),
            executionPolicyRegistry,
            2 days,
            address(this),
            address(0xA990),
            address(0xC001),
            address(0xFA02)
        );
        registry = new ProgrammableCustomRegistryV2(
            ProgrammableCustomRegistryV1.RegistryConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: address(this),
                initialApprover: address(0xA990),
                initialWriter: predictedRegistrar,
                initialFinalizer: address(0xF001),
                initialCorrector: address(revisionRegistry),
                initialRevoker: address(this),
                registryGeneration: 2,
                minimumFinalityBlocks: 3,
                chainProfileHash: keccak256("ethereum-mainnet-chain-profile-v2"),
                registryPolicyHash: keccak256("registry-policy-v2")
            }),
            partnerRegistry,
            verifier,
            executionPolicyRegistry,
            revisionRegistry
        );
        address predictedStamp = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        ProgrammableCustomAtomicRegistrarV2 registrar = new ProgrammableCustomAtomicRegistrarV2(
            registry, executionPolicyRegistry, partnerRegistry, ProgrammableLaunchStampV1(predictedStamp)
        );
        new ProgrammableLaunchStampV1(registry, executionPolicyRegistry, address(registrar));
        assertEq(address(registrar), predictedRegistrar);
        RegistryInvariantApprovalActorV2 approvalActor = new RegistryInvariantApprovalActorV2(registry);
        registry.grantRole(registry.APPROVER_ROLE(), address(approvalActor));
        registry.revokeRole(registry.APPROVER_ROLE(), address(0xA990));
        handler = new ProgrammableCustomRegistryV2InvariantHandler(
            registry, approvalActor, runtimeTarget, registrar, executionPolicyRegistry
        );
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
