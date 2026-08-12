// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Test } from "forge-std/Test.sol";

import { ProgrammableExactShardsFeePolicyVerifierV1 } from "../src/ProgrammableExactShardsFeePolicyVerifierV1.sol";
import { ProgrammableExactShardsRegistryV1 } from "../src/ProgrammableExactShardsRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";
import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "../src/interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";
import { IProgrammableExactShardsRegistryV1 } from "../src/interfaces/IProgrammableExactShardsRegistryV1.sol";

contract ExactShardsRegistryRuntimeTargetV1 {
    function version() external pure returns (uint256) {
        return 1;
    }
}

contract ExactShardsVerifierImpostorV1 {
    function feePolicyBindingHashV1() external pure returns (bytes32) {
        return 0x5d5d1c46e7627f6e171a18acdbecbfe9e40eca80016fba0142ddca6a054f6169;
    }
}

contract ProgrammableExactShardsRegistryV1Test is Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant APPROVER = address(0xA990);
    address internal constant WRITER = address(0xB001);
    address internal constant FINALIZER = address(0xF1A1);
    address internal constant CORRECTOR = address(0xC011);
    address internal constant REVOKER = address(0xDEAD);
    address internal constant OUTSIDER = address(0xBAD);

    uint64 internal constant GENERATION = 3;
    uint64 internal constant FINALITY_BLOCKS = 3;
    uint256 internal constant MAX_REGISTRATION_GAS = 2_200_000;

    ProgrammableExactShardsFeePolicyVerifierV1 internal verifier;
    ProgrammableExactShardsRegistryV1 internal registry;
    ExactShardsRegistryRuntimeTargetV1 internal runtimeTarget;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        vm.warp(1_800_000_000);
        verifier = new ProgrammableExactShardsFeePolicyVerifierV1();
        runtimeTarget = new ExactShardsRegistryRuntimeTargetV1();
        registry = _newRegistry(verifier);
    }

    function test_constructorPinsExactVerifierInstanceScopeAndLeastPrivilege() public view {
        assertEq(registry.CHAIN_ID(), 1);
        assertEq(registry.REGISTRY_GENERATION(), GENERATION);
        assertEq(registry.MINIMUM_FINALITY_BLOCKS(), FINALITY_BLOCKS);
        assertEq(address(registry.FEE_POLICY_VERIFIER()), address(verifier));
        assertEq(registry.VERIFIER_RUNTIME_CODE_HASH(), address(verifier).codehash);
        assertEq(registry.VERIFIER_RUNTIME_CODE_HASH(), registry.EXPECTED_VERIFIER_RUNTIME_CODE_HASH());
        assertEq(registry.FEE_POLICY_BINDING_HASH(), verifier.feePolicyBindingHashV1());
        assertEq(registry.FEE_POLICY_BINDING_HASH(), registry.EXPECTED_FEE_POLICY_BINDING_HASH());
        assertEq(
            registry.REGISTRY_INSTANCE_HASH(),
            keccak256(
                abi.encode(
                    registry.REGISTRY_SCHEMA_ID(),
                    block.chainid,
                    GENERATION,
                    address(registry),
                    registry.CHAIN_PROFILE_HASH(),
                    registry.REGISTRY_POLICY_HASH(),
                    address(verifier),
                    address(verifier).codehash,
                    verifier.feePolicyBindingHashV1()
                )
            )
        );
        assertTrue(registry.hasRole(registry.APPROVER_ROLE(), APPROVER));
        assertTrue(registry.hasRole(registry.WRITER_ROLE(), WRITER));
        assertFalse(registry.hasRole(registry.APPROVER_ROLE(), WRITER));
        assertFalse(registry.hasRole(registry.WRITER_ROLE(), APPROVER));
    }

    function test_constructorRejectsVerifierImpostorDespiteMatchingClaimedBinding() public {
        ExactShardsVerifierImpostorV1 impostor = new ExactShardsVerifierImpostorV1();
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableExactShardsRegistryV1.RuntimeCodeHashMismatch.selector,
                address(impostor),
                registry.EXPECTED_VERIFIER_RUNTIME_CODE_HASH(),
                address(impostor).codehash
            )
        );
        new ProgrammableExactShardsRegistryV1(_config(), ProgrammableExactShardsFeePolicyVerifierV1(address(impostor)));
    }

    function test_machineCheckableSpecMatchesArtifactAndFailClosedBoundary() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/spec/shards-registry-successor-v1.json"));
        assertEq(vm.parseJsonString(json, ".schemaVersion"), "programmable.exact-shards-registry-successor.v1");
        assertEq(vm.parseJsonString(json, ".status"), "IMPLEMENTATION_READY_NOT_DEPLOYED");
        assertFalse(vm.parseJsonBool(json, ".activationAllowed"));
        assertFalse(vm.parseJsonBool(json, ".launchAllowed"));
        assertFalse(vm.parseJsonBool(json, ".decision.currentContractsCanLaunch"));
        assertEq(vm.parseJsonUint(json, ".exactPolicy.totalFeeBps"), 100);
        assertEq(vm.parseJsonUint(json, ".exactPolicy.orderedClaims[0].grossVolumeFeeBps"), 10);
        assertEq(vm.parseJsonUint(json, ".exactPolicy.orderedClaims[1].grossVolumeFeeBps"), 10);
        assertEq(vm.parseJsonUint(json, ".exactPolicy.orderedClaims[2].grossVolumeFeeBps"), 80);
        assertEq(
            vm.parseJsonBytes32(json, ".reviewedInputs.feeVerifier.contentBindingHash"),
            registry.FEE_POLICY_BINDING_HASH()
        );
        assertEq(
            keccak256(type(ProgrammableExactShardsRegistryV1).creationCode),
            vm.parseJsonBytes32(json, ".implementation.artifact.creationCodeKeccak256")
        );
        string memory buildArtifact = vm.readFile(
            string.concat(
                vm.projectRoot(), "/out/ProgrammableExactShardsRegistryV1.sol/ProgrammableExactShardsRegistryV1.json"
            )
        );
        bytes memory unlinkedRuntime = vm.parseBytes(vm.parseJsonString(buildArtifact, ".deployedBytecode.object"));
        assertEq(
            keccak256(unlinkedRuntime),
            vm.parseJsonBytes32(json, ".implementation.artifact.unlinkedRuntimeCodeKeccak256")
        );
        assertEq(
            type(ProgrammableExactShardsRegistryV1).creationCode.length,
            vm.parseJsonUint(json, ".implementation.artifact.creationCodeByteLength")
        );
        assertEq(
            unlinkedRuntime.length, vm.parseJsonUint(json, ".implementation.artifact.unlinkedRuntimeCodeByteLength")
        );
        assertEq(address(registry).code.length, unlinkedRuntime.length);
    }

    function test_registersAndStoresAllThreeClaimsWithExactHashBinding() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration = _registration("canonical");
        bytes32 feePolicyRecordHash =
            registry.computeFeePolicyRecordHash(registration.feePolicy, registration.orderedFeeLegs);
        bytes32 policyHash = registry.computeFeePolicyHash(registration.feePolicy, registration.orderedFeeLegs);
        _authorize(registration);

        vm.prank(WRITER);
        registry.registerLaunch(registration);

        IProgrammableExactShardsRegistryV1.LaunchStateV1 memory state = registry.launchState(registration.launchId);
        IProgrammableExactShardsRegistryV1.StoredFeePolicyV1 memory storedPolicy =
            registry.feePolicyState(registration.launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed));
        assertEq(state.feePolicyHash, policyHash);
        assertEq(state.feePolicyRecordHash, feePolicyRecordHash);
        assertEq(storedPolicy.policyHash, policyHash);
        assertEq(storedPolicy.feePolicyRecordHash, feePolicyRecordHash);
        assertEq(storedPolicy.verifierBindingHash, verifier.feePolicyBindingHashV1());
        assertEq(storedPolicy.verifierRuntimeCodeHash, address(verifier).codehash);
        assertEq(storedPolicy.totalFeeBps, 100);

        IProgrammableExactShardsRegistryV1.StoredFeeClaimV1 memory builder = registry.feeClaim(registration.launchId, 0);
        IProgrammableExactShardsRegistryV1.StoredFeeClaimV1 memory programmable =
            registry.feeClaim(registration.launchId, 1);
        IProgrammableExactShardsRegistryV1.StoredFeeClaimV1 memory holders = registry.feeClaim(registration.launchId, 2);
        assertEq(builder.ordinal, 0);
        assertEq(builder.grossVolumeFeeBps, 10);
        assertEq(builder.shareOfFeeBps, 1000);
        assertEq(builder.claimSelector, bytes4(0x69f9a5f0));
        assertEq(builder.handoffSelector, bytes4(0x4ce11d21));
        assertEq(programmable.ordinal, 1);
        assertEq(programmable.grossVolumeFeeBps, 10);
        assertEq(programmable.shareOfFeeBps, 1000);
        assertEq(programmable.claimSelector, bytes4(0x64d46b85));
        assertEq(programmable.handoffSelector, bytes4(0));
        assertEq(holders.ordinal, 2);
        assertEq(holders.grossVolumeFeeBps, 80);
        assertEq(holders.shareOfFeeBps, 8000);
        assertEq(holders.claimSelector, bytes4(0x6ba4c138));
        assertEq(holders.handoffSelector, bytes4(0));
        assertEq(
            storedPolicy.claimSetHash,
            keccak256(abi.encode(builder.storedClaimHash, programmable.storedClaimHash, holders.storedClaimHash))
        );
        assertTrue(registry.approvalConsumed(registration.approvalId));
        assertTrue(registry.deploymentConsumed(registration.deploymentId));
    }

    function test_registrationGasStaysBelowHardMaximum() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration = _registration("gas-bound");
        _authorize(registration);

        vm.prank(WRITER);
        uint256 gasBefore = gasleft();
        registry.registerLaunch(registration);
        uint256 registrationGas = gasBefore - gasleft();

        assertLe(registrationGas, MAX_REGISTRATION_GAS);
    }

    function test_completeLifecycleFinalityCorrectionAndRevocation() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration = _registration("lifecycle");
        _register(registration);
        bytes32 feePolicyRecordHash = registry.feePolicyState(registration.launchId).feePolicyRecordHash;
        bytes32 builderClaimHash = registry.feeClaim(registration.launchId, 0).storedClaimHash;

        vm.roll(104);
        bytes32 observedHash = _hash("block-100");
        bytes32 confirmedHeadHash = _hash("block-103");
        vm.setBlockhash(100, observedHash);
        vm.setBlockhash(103, confirmedHeadHash);
        IProgrammableCustomRegistryV1.FinalityProofV1 memory proof =
            _finalityProof(registration, observedHash, confirmedHeadHash, _hash("finality-evidence"));
        vm.prank(FINALIZER);
        registry.finalizeLaunch(proof);

        bytes32 correctedHash = _hash("corrected-record");
        vm.prank(CORRECTOR);
        registry.correctLaunchRecord(
            IProgrammableCustomRegistryV1.RecordCorrectionV1({
                chainId: block.chainid,
                registryGeneration: GENERATION,
                launchId: registration.launchId,
                revision: 2,
                previousRecordHash: registration.registeredRecordCommitment,
                correctedRecordHash: correctedHash,
                reasonCode: _hash("correction-reason"),
                evidenceHash: _hash("correction-evidence")
            })
        );

        vm.prank(REVOKER);
        registry.revokeLaunch(
            IProgrammableCustomRegistryV1.LaunchRevocationV1({
                chainId: block.chainid,
                registryGeneration: GENERATION,
                launchId: registration.launchId,
                reasonCode: _hash("revocation-reason"),
                evidenceHash: _hash("revocation-evidence")
            })
        );

        IProgrammableExactShardsRegistryV1.LaunchStateV1 memory state = registry.launchState(registration.launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV1.LaunchStatus.Revoked));
        assertEq(state.finalizedAtBlock, 104);
        assertEq(state.finalityEvidenceHash, proof.finalityEvidenceHash);
        assertEq(state.latestRecordRevision, 2);
        assertEq(state.latestRecordHash, correctedHash);
        assertEq(registry.recordHashAtRevision(registration.launchId, 1), registration.registeredRecordCommitment);
        assertEq(registry.recordHashAtRevision(registration.launchId, 2), correctedHash);
        assertEq(registry.feePolicyState(registration.launchId).feePolicyRecordHash, feePolicyRecordHash);
        assertEq(registry.feeClaim(registration.launchId, 0).storedClaimHash, builderClaimHash);
        assertEq(registry.transitionCount(), 5);
    }

    function test_rejectsWrongLegWrongEconomicsAndTwoClaimCollapseWithoutConsumption() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory wrongLeg = _registration("wrong-leg");
        _authorize(wrongLeg);
        wrongLeg.orderedFeeLegs[0].recipient = address(1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IProgrammableExactShardsFeePolicyVerifierV1.InvalidShardsFeePolicy.selector, uint8(5)
            )
        );
        vm.prank(WRITER);
        registry.registerLaunch(wrongLeg);
        assertFalse(registry.approvalConsumed(wrongLeg.approvalId));
        assertFalse(registry.deploymentConsumed(wrongLeg.deploymentId));

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory wrongEconomics = _registration("wrong-economics");
        _authorize(wrongEconomics);
        wrongEconomics.feePolicy.totalFeeBps = 101;
        vm.expectRevert(
            abi.encodeWithSelector(
                IProgrammableExactShardsFeePolicyVerifierV1.InvalidShardsFeePolicy.selector, uint8(4)
            )
        );
        vm.prank(WRITER);
        registry.registerLaunch(wrongEconomics);
        assertFalse(registry.approvalConsumed(wrongEconomics.approvalId));

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory collapsed = _registration("collapsed");
        _authorize(collapsed);
        collapsed.orderedFeeLegs[0].feeBps = 20;
        collapsed.orderedFeeLegs[1] = collapsed.orderedFeeLegs[2];
        collapsed.orderedFeeLegs[2].feeBps = 0;
        vm.expectRevert(
            abi.encodeWithSelector(
                IProgrammableExactShardsFeePolicyVerifierV1.InvalidShardsFeePolicy.selector, uint8(5)
            )
        );
        vm.prank(WRITER);
        registry.registerLaunch(collapsed);
        assertFalse(registry.approvalConsumed(collapsed.approvalId));
    }

    function test_rejectsApprovalDeploymentEvidenceAndRegistryInstanceReplay() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory first = _registration("first");
        _register(first);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory approvalReplay = _registration("approval-replay");
        approvalReplay.approvalId = first.approvalId;
        _rebind(approvalReplay);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsRegistryV1.ApprovalAlreadyConsumed.selector, first.approvalId)
        );
        vm.prank(WRITER);
        registry.registerLaunch(approvalReplay);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory deploymentReplay =
            _registration("deployment-replay");
        deploymentReplay.deploymentId = first.deploymentId;
        _rebind(deploymentReplay);
        _authorize(deploymentReplay);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableExactShardsRegistryV1.DeploymentAlreadyConsumed.selector, first.deploymentId
            )
        );
        vm.prank(WRITER);
        registry.registerLaunch(deploymentReplay);

        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory evidenceReplay = _authorization(first);
        evidenceReplay.approvalId = _hash("fresh-approval-id");
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableExactShardsRegistryV1.EvidenceAlreadyConsumed.selector, evidenceReplay.evidenceHash
            )
        );
        vm.prank(APPROVER);
        registry.authorizeApproval(evidenceReplay);

        ProgrammableExactShardsRegistryV1 otherRegistry = _newRegistry(verifier);
        assertNotEq(otherRegistry.REGISTRY_INSTANCE_HASH(), registry.REGISTRY_INSTANCE_HASH());
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory copiedAuthorization = _authorization(first);
        vm.prank(APPROVER);
        otherRegistry.authorizeApproval(copiedAuthorization);
        vm.expectPartialRevert(ProgrammableExactShardsRegistryV1.ApprovalBindingMismatch.selector);
        vm.prank(WRITER);
        otherRegistry.registerLaunch(first);
    }

    function test_rejectsAuthorizationMutationAndTerminalRevocation() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory mutation = _registration("mutation");
        _authorize(mutation);
        mutation.securityReviewHash = _hash("substituted-review");
        _rebindRecordOnly(mutation);
        vm.expectPartialRevert(ProgrammableExactShardsRegistryV1.RegistrationBindingMismatch.selector);
        vm.prank(WRITER);
        registry.registerLaunch(mutation);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory revoked = _registration("revoked");
        _register(revoked);
        vm.prank(REVOKER);
        registry.revokeLaunch(
            IProgrammableCustomRegistryV1.LaunchRevocationV1({
                chainId: block.chainid,
                registryGeneration: GENERATION,
                launchId: revoked.launchId,
                reasonCode: _hash("reason"),
                evidenceHash: _hash("evidence")
            })
        );
        vm.expectPartialRevert(ProgrammableExactShardsRegistryV1.LaunchAlreadyRegistered.selector);
        vm.prank(WRITER);
        registry.registerLaunch(revoked);
    }

    function test_rejectsApprovedSourceRouteProfileAndProviderDrift() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory sourceDrift = _registration("source-drift");
        sourceDrift.sourceCommitment = _hash("different-source");
        _rebind(sourceDrift);
        _authorize(sourceDrift);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableExactShardsRegistryV1.InvalidBinding.selector, bytes32("reviewed-source")
            )
        );
        vm.prank(WRITER);
        registry.registerLaunch(sourceDrift);
        assertFalse(registry.approvalConsumed(sourceDrift.approvalId));

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory routeDrift = _registration("route-drift");
        routeDrift.buildCommitment = _hash("different-route");
        _rebind(routeDrift);
        _authorize(routeDrift);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsRegistryV1.InvalidBinding.selector, bytes32("reviewed-route"))
        );
        vm.prank(WRITER);
        registry.registerLaunch(routeDrift);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory profileDrift = _registration("profile-drift");
        profileDrift.marketPathId = _hash("different-profile");
        _rebind(profileDrift);
        _authorize(profileDrift);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsRegistryV1.InvalidBinding.selector, bytes32("market-profile"))
        );
        vm.prank(WRITER);
        registry.registerLaunch(profileDrift);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory providerDrift = _registration("provider-drift");
        providerDrift.providerId = _hash("unreviewed-provider");
        _rebind(providerDrift);
        _authorize(providerDrift);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsRegistryV1.InvalidBinding.selector, bytes32("provider-id"))
        );
        vm.prank(WRITER);
        registry.registerLaunch(providerDrift);
    }

    function test_finalityFailsClosedOnDepthHashAndEvidenceReplay() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration = _registration("finality");
        _register(registration);
        vm.roll(102);
        vm.setBlockhash(100, _hash("block-100"));
        vm.setBlockhash(101, _hash("block-101"));
        IProgrammableCustomRegistryV1.FinalityProofV1 memory shallow =
            _finalityProof(registration, _hash("block-100"), _hash("block-101"), _hash("shallow-evidence"));
        shallow.confirmedHeadBlockNumber = 101;
        vm.expectPartialRevert(ProgrammableExactShardsRegistryV1.FinalityDepthInsufficient.selector);
        vm.prank(FINALIZER);
        registry.finalizeLaunch(shallow);

        vm.roll(104);
        vm.setBlockhash(100, _hash("canonical-100"));
        vm.setBlockhash(103, _hash("block-103"));
        IProgrammableCustomRegistryV1.FinalityProofV1 memory wrongHash =
            _finalityProof(registration, _hash("fake-100"), _hash("block-103"), _hash("wrong-hash-evidence"));
        vm.expectPartialRevert(ProgrammableExactShardsRegistryV1.BlockHashMismatch.selector);
        vm.prank(FINALIZER);
        registry.finalizeLaunch(wrongHash);

        IProgrammableCustomRegistryV1.FinalityProofV1 memory valid = _finalityProof(
            registration, _hash("canonical-100"), _hash("block-103"), _hash("valid-finality-evidence")
        );
        vm.prank(FINALIZER);
        registry.finalizeLaunch(valid);
        assertTrue(registry.transitionEvidenceConsumed(valid.finalityEvidenceHash));

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory second = _registration("second-finality");
        _register(second);
        vm.roll(108);
        vm.setBlockhash(104, _hash("block-104"));
        vm.setBlockhash(107, _hash("block-107"));
        IProgrammableCustomRegistryV1.FinalityProofV1 memory replay =
            _finalityProof(second, _hash("block-104"), _hash("block-107"), valid.finalityEvidenceHash);
        replay.observedBlockNumber = 104;
        replay.confirmedHeadBlockNumber = 107;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableExactShardsRegistryV1.EvidenceAlreadyConsumed.selector, valid.finalityEvidenceHash
            )
        );
        vm.prank(FINALIZER);
        registry.finalizeLaunch(replay);
    }

    function test_roleSeparationAndWrongCallerFailClosed() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration = _registration("roles");
        _authorize(registration);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, OUTSIDER, registry.WRITER_ROLE()
            )
        );
        vm.prank(OUTSIDER);
        registry.registerLaunch(registration);

        bytes32 writerRole = registry.WRITER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsRegistryV1.IncompatibleOperationalRoles.selector, APPROVER)
        );
        vm.prank(ADMIN);
        registry.grantRole(writerRole, APPROVER);
    }

    function testFuzz_anyGrossFeeMutationFailsClosed(uint16 builderFee, uint16 programmableFee, uint16 holderFee)
        public
    {
        vm.assume(builderFee != 10 || programmableFee != 10 || holderFee != 80);
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration = _registration("fuzz-fees");
        registration.orderedFeeLegs[0].feeBps = builderFee;
        registration.orderedFeeLegs[1].feeBps = programmableFee;
        registration.orderedFeeLegs[2].feeBps = holderFee;
        vm.expectRevert();
        registry.computeFeePolicyRecordHash(registration.feePolicy, registration.orderedFeeLegs);
    }

    function _newRegistry(ProgrammableExactShardsFeePolicyVerifierV1 verifier_)
        private
        returns (ProgrammableExactShardsRegistryV1)
    {
        return new ProgrammableExactShardsRegistryV1(_config(), verifier_);
    }

    function _config() private pure returns (ProgrammableExactShardsRegistryV1.RegistryConfigV1 memory config) {
        config = ProgrammableExactShardsRegistryV1.RegistryConfigV1({
            initialAdminDelay: 2 days,
            initialAdmin: ADMIN,
            initialApprover: APPROVER,
            initialWriter: WRITER,
            initialFinalizer: FINALIZER,
            initialCorrector: CORRECTOR,
            initialRevoker: REVOKER,
            registryGeneration: GENERATION,
            minimumFinalityBlocks: FINALITY_BLOCKS,
            chainProfileHash: _hash("ethereum-mainnet-chain-profile"),
            registryPolicyHash: _hash("exact-shards-registry-policy")
        });
    }

    function _registration(string memory label)
        private
        view
        returns (IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration.chainId = block.chainid;
        registration.registryGeneration = GENERATION;
        registration.launchId = _hash(string.concat(label, "-launch-id"));
        registration.projectId = _hash(string.concat(label, "-project-id"));
        registration.approvalId = _hash(string.concat(label, "-approval-id"));
        registration.repositoryId = _hash("jesse-stahl/shards-v1");
        registration.commitId = bytes32(bytes20(hex"91b38f3de64d96cac7e29f127c004f128fc1da59"));
        registration.sourceCommitment = verifier.SOURCE_REVISION_HASH();
        registration.buildCommitment = verifier.NESTED_FACTORY_ARTIFACT_SHA256();
        registration.artifactSetHash = _hash(string.concat(label, "-artifact-set"));
        registration.deploymentConfigurationHash = _hash(string.concat(label, "-deployment-configuration"));
        registration.configurationHash = _hash(string.concat(label, "-configuration"));
        registration.permissionsHash = _hash(string.concat(label, "-permissions"));
        registration.deploymentId = _hash(string.concat(label, "-deployment-id"));
        registration.deploymentSetHash = _hash(string.concat(label, "-deployment-set"));
        registration.runtimeCodeSetHash = _hash(string.concat(label, "-runtime-code-set"));
        registration.primaryContract = address(runtimeTarget);
        registration.primaryRuntimeCodeHash = address(runtimeTarget).codehash;
        registration.launchWallet = address(0x51A4D5);
        registration.modelId = _hash("programmable.exact-shards.v1");
        registration.modelVersion = _hash("1");
        registration.templateId = _hash("programmable.exact-shards.nested-factory.v1");
        registration.templateVersion = _hash("1");
        registration.providerId = bytes32(0);
        registration.builderAttributionHash = _hash(string.concat(label, "-builder"));
        registration.originHash = _hash(string.concat(label, "-origin"));
        registration.assetSetHash = _hash(string.concat(label, "-assets"));
        registration.marketSetHash = _hash(string.concat(label, "-markets"));
        registration.marketPathId = verifier.PROFILE_KEY();
        registration.capabilitySetHash = _hash(string.concat(label, "-capabilities"));
        registration.reviewPolicyHash = _hash("programmable-shards-review-policy-v1");
        registration.securityReviewHash = _hash(string.concat(label, "-security-review"));
        registration.reviewResultId = _hash(string.concat(label, "-review-result"));
        registration.finalityPolicyHash = _hash("programmable-finality-policy-v1");

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
        _rebind(registration);
    }

    function _rebind(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private view {
        registration.approvalBindingHash = registry.computeApprovalBindingHash(registration);
        registration.reviewDeploymentBindingHash = registry.computeReviewDeploymentBindingHash(registration);
        registration.registeredRecordCommitment = registry.computeRegisteredRecordCommitment(registration);
    }

    function _rebindRecordOnly(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
    {
        registration.reviewDeploymentBindingHash = registry.computeReviewDeploymentBindingHash(registration);
        registration.registeredRecordCommitment = registry.computeRegisteredRecordCommitment(registration);
    }

    function _authorization(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory authorization)
    {
        authorization = IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
            chainId: registration.chainId,
            registryGeneration: registration.registryGeneration,
            approvalId: registration.approvalId,
            launchId: registration.launchId,
            approvalBindingHash: registration.approvalBindingHash,
            registrationBindingHash: registry.computeRegistrationBindingHash(registration),
            validAfterBlock: uint64(block.number),
            expiresAtBlock: uint64(block.number + 200),
            evidenceHash: keccak256(abi.encode("approval-evidence", registration.approvalId))
        });
    }

    function _authorize(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private {
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory authorization = _authorization(registration);
        vm.prank(APPROVER);
        registry.authorizeApproval(authorization);
    }

    function _register(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private {
        _authorize(registration);
        vm.prank(WRITER);
        registry.registerLaunch(registration);
    }

    function _finalityProof(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration,
        bytes32 observedBlockHash,
        bytes32 confirmedHeadBlockHash,
        bytes32 evidenceHash
    ) private pure returns (IProgrammableCustomRegistryV1.FinalityProofV1 memory proof) {
        proof.chainId = registration.chainId;
        proof.registryGeneration = registration.registryGeneration;
        proof.launchId = registration.launchId;
        proof.observedBlockNumber = 100;
        proof.observedBlockHash = observedBlockHash;
        proof.observedTransactionHash = _hash("observed-transaction");
        proof.observedTransactionIndex = 1;
        proof.observedLogIndex = 2;
        proof.confirmedHeadBlockNumber = 103;
        proof.confirmedHeadBlockHash = confirmedHeadBlockHash;
        proof.finalityPolicyHash = registration.finalityPolicyHash;
        proof.finalityEvidenceHash = evidenceHash;
    }

    function _hash(string memory value) private pure returns (bytes32) {
        return keccak256(bytes(value));
    }
}
