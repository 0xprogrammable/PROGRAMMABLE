// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Test } from "forge-std/Test.sol";

import { ProgrammableExactShardsFeePolicyVerifierV2 } from "../src/ProgrammableExactShardsFeePolicyVerifierV2.sol";
import { ProgrammableExactShardsRegistryV1 } from "../src/ProgrammableExactShardsRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";
import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "../src/interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";
import { IProgrammableExactShardsRegistryV1 } from "../src/interfaces/IProgrammableExactShardsRegistryV1.sol";
import { IProgrammableLaunchPermitAuthorityV1 } from "../src/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { ProgrammableExactShardsBindingHarnessV1 } from "./utils/ProgrammableExactShardsBindingHarnessV1.sol";

contract ExactShardsRegistryRuntimeTargetV1 {
    function version() external pure returns (uint256) {
        return 1;
    }
}

contract ExactShardsVerifierImpostorV2 {
    function feePolicyBindingHashV2() external pure returns (bytes32) {
        return 0xfad5a3fbf661221cdfc8cb96f6df69b46b97775692bed2521c652db678e15e0d;
    }
}

/// @dev Registry-unit fixture only. Global repository consumption is owned and tested by the real Permit Authority.
contract ExactShardsPermitAuthorityReadbackV1 {
    function computeRepositoryKey(uint64 githubRepositoryId) external pure returns (bytes32) {
        require(githubRepositoryId != 0, "repository-id");
        return keccak256(abi.encode("programmable.github.repository.v1", uint256(githubRepositoryId)));
    }
}

contract ProgrammableExactShardsRegistryV1Test is Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant APPROVER = address(0xA990);
    address internal constant INTENT_APPROVER = address(0xA991);
    address internal constant WRITER = address(0xB001);
    address internal constant FINALIZER = address(0xF1A1);
    address internal constant REVOKER = address(0xDEAD);
    address internal constant OUTSIDER = address(0xBAD);

    uint64 internal constant GENERATION = 3;
    uint64 internal constant FINALITY_BLOCKS = 3;
    uint64 internal constant SHARDS_GITHUB_REPOSITORY_ID = 1_329_073_878;
    uint256 internal constant MAX_REGISTRATION_GAS = 2_200_000;

    ProgrammableExactShardsFeePolicyVerifierV2 internal verifier;
    ProgrammableExactShardsRegistryV1 internal registry;
    ExactShardsPermitAuthorityReadbackV1 internal permitAuthority;
    ProgrammableExactShardsBindingHarnessV1 internal bindingHarness;
    ExactShardsRegistryRuntimeTargetV1 internal runtimeTarget;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        vm.warp(1_800_000_000);
        verifier = new ProgrammableExactShardsFeePolicyVerifierV2();
        permitAuthority = new ExactShardsPermitAuthorityReadbackV1();
        runtimeTarget = new ExactShardsRegistryRuntimeTargetV1();
        registry = _newRegistry(verifier);
        bindingHarness = new ProgrammableExactShardsBindingHarnessV1(
            registry, verifier, IProgrammableLaunchPermitAuthorityV1(address(permitAuthority))
        );
    }

    function test_constructorPinsExactVerifierInstanceScopeAndLeastPrivilege() public view {
        assertEq(registry.CHAIN_ID(), 1);
        assertEq(registry.REGISTRY_GENERATION(), GENERATION);
        assertEq(registry.MINIMUM_FINALITY_BLOCKS(), FINALITY_BLOCKS);
        assertEq(address(registry.FEE_POLICY_VERIFIER()), address(verifier));
        assertEq(registry.VERIFIER_RUNTIME_CODE_HASH(), address(verifier).codehash);
        assertEq(registry.FEE_POLICY_BINDING_HASH(), verifier.feePolicyBindingHashV2());
        assertEq(registry.FEE_POLICY_BINDING_HASH(), verifier.EXPECTED_FEE_POLICY_BINDING_HASH());
        assertEq(registry.ECONOMIC_TEMPLATE_HASH(), verifier.EXPECTED_ECONOMIC_TEMPLATE_HASH());
        assertEq(
            registry.REGISTRY_INSTANCE_HASH(),
            keccak256(
                abi.encode(
                    keccak256("programmable.exact-shards-registry.v1"),
                    block.chainid,
                    GENERATION,
                    address(registry),
                    registry.CHAIN_PROFILE_HASH(),
                    registry.REGISTRY_POLICY_HASH(),
                    address(verifier),
                    address(verifier).codehash,
                    verifier.feePolicyBindingHashV2(),
                    address(permitAuthority),
                    address(permitAuthority).codehash
                )
            )
        );
        assertTrue(registry.hasRole(keccak256("programmable.custom-registry.approver.v1"), APPROVER));
        assertTrue(registry.hasRole(registry.WRITER_ROLE(), WRITER));
        assertFalse(registry.hasRole(keccak256("programmable.custom-registry.approver.v1"), WRITER));
        assertFalse(registry.hasRole(registry.WRITER_ROLE(), APPROVER));
    }

    function test_constructorRejectsVerifierImpostorDespiteMatchingClaimedBinding() public {
        ExactShardsVerifierImpostorV2 impostor = new ExactShardsVerifierImpostorV2();
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableExactShardsRegistryV1.RuntimeCodeHashMismatch.selector,
                address(impostor),
                registry.VERIFIER_RUNTIME_CODE_HASH(),
                address(impostor).codehash
            )
        );
        new ProgrammableExactShardsRegistryV1(
            _config(),
            ProgrammableExactShardsFeePolicyVerifierV2(address(impostor)),
            IProgrammableLaunchPermitAuthorityV1(address(permitAuthority))
        );
    }

    function test_machineCheckableSpecMatchesArtifactAndFailClosedBoundary() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/spec/shards-registry-successor-v2.json"));
        assertEq(vm.parseJsonString(json, ".schemaVersion"), "programmable.exact-shards-registry-successor.v2");
        assertEq(vm.parseJsonString(json, ".status"), "SOURCE_CANDIDATE_NOT_DEPLOYED");
        assertFalse(vm.parseJsonBool(json, ".activationAllowed"));
        assertFalse(vm.parseJsonBool(json, ".launchAllowed"));
        assertFalse(vm.parseJsonBool(json, ".externalActionOccurred"));
        assertEq(vm.parseJsonUint(json, ".exactPolicy.totalFeeBps"), 100);
        assertEq(vm.parseJsonUint(json, ".exactPolicy.orderedClaims[0].grossVolumeFeeBps"), 10);
        assertEq(vm.parseJsonUint(json, ".exactPolicy.orderedClaims[1].grossVolumeFeeBps"), 10);
        assertEq(vm.parseJsonUint(json, ".exactPolicy.orderedClaims[2].grossVolumeFeeBps"), 80);
        string[] memory technical = vm.parseJsonStringArray(json, ".productBoundary.durableTechnicalInputs");
        string[] memory selected = vm.parseJsonStringArray(json, ".productBoundary.websiteSelectedInputs");
        string[] memory jit = vm.parseJsonStringArray(json, ".productBoundary.jitDeploymentInputs");
        assertEq(technical.length, 9);
        assertEq(selected.length, 4);
        assertEq(selected[0], "tokenName");
        assertEq(selected[1], "tokenSymbol");
        assertEq(selected[2], "presentationBindingHash");
        assertEq(selected[3], "launchWallet");
        assertEq(jit.length, 11);
        assertEq(
            vm.parseJsonString(json, ".productBoundary.deterministicallyDerivedMetadata.nftName"),
            "tokenName + ASCII_SPACE + Pieces"
        );
        assertEq(
            vm.parseJsonString(json, ".productBoundary.deterministicallyDerivedMetadata.nftSymbol"),
            "tokenSymbol + ASCII_N"
        );
        assertFalse(vm.parseJsonBool(json, ".productBoundary.deterministicallyDerivedMetadata.websiteMayOverride"));
        assertFalse(vm.parseJsonBool(json, ".productBoundary.presentationIsSourceInput"));
        assertTrue(vm.parseJsonBool(json, ".productBoundary.technicalApprovalSurvivesPresentationOnlyChange"));
        assertTrue(vm.parseJsonBool(json, ".productBoundary.jitPermitBindsSelectedDerivedAndPredictedValues"));
        assertTrue(vm.parseJsonBool(json, ".registryBinding.permitAuthorityAndVerifierRequired"));
        assertTrue(vm.parseJsonBool(json, ".registryBinding.launchRouteImmutable"));
        assertTrue(vm.parseJsonBool(json, ".registryBinding.launchRouteSoleWriter"));
        assertTrue(vm.parseJsonBool(json, ".registryBinding.durableApproverSeparatedFromJitIntentApprover"));
        assertFalse(vm.parseJsonBool(json, ".registryBinding.correctionAllowed"));
        assertTrue(vm.parseJsonBool(json, ".registryBinding.revocationIsTerminal"));
        assertFalse(vm.parseJsonBool(json, ".roles.sameAddressAcrossOperationalClassesAllowed"));
        assertEq(vm.parseJsonUint(json, ".registryBinding.registeredRecordRevision"), 1);
        assertEq(vm.parseJsonBytes32(json, ".exactPolicy.feePolicyBindingHash"), registry.FEE_POLICY_BINDING_HASH());
        assertEq(
            keccak256(type(ProgrammableExactShardsRegistryV1).creationCode),
            vm.parseJsonBytes32(json, ".components[3].artifact.creationTemplateKeccak256")
        );
        string memory buildArtifact = vm.readFile(
            string.concat(
                vm.projectRoot(), "/out/ProgrammableExactShardsRegistryV1.sol/ProgrammableExactShardsRegistryV1.json"
            )
        );
        bytes memory unlinkedRuntime = vm.parseBytes(vm.parseJsonString(buildArtifact, ".deployedBytecode.object"));
        assertTrue(vm.parseJsonBool(json, ".compiler.optimizerEnabled"));
        assertEq(vm.parseJsonUint(json, ".compiler.optimizerRuns"), 1000);
        assertFalse(vm.parseJsonBool(json, ".compiler.viaIR"));
        assertEq(
            keccak256(unlinkedRuntime), vm.parseJsonBytes32(json, ".components[3].artifact.runtimeTemplateKeccak256")
        );
        assertEq(
            type(ProgrammableExactShardsRegistryV1).creationCode.length,
            vm.parseJsonUint(json, ".components[3].artifact.creationTemplateByteLength")
        );
        assertEq(unlinkedRuntime.length, vm.parseJsonUint(json, ".components[3].artifact.runtimeTemplateByteLength"));
        assertEq(address(registry).code.length, unlinkedRuntime.length);
        assertEq(
            24_576 - unlinkedRuntime.length,
            vm.parseJsonUint(json, ".components[3].artifact.runtimeCodeLimitMarginBytes")
        );
    }

    function test_registersAndStoresAllThreeClaimsWithExactHashBinding() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration = _registration("canonical");
        bytes32 policyHash = verifier.verify(registration.feePolicy, registration.orderedFeeLegs);
        _authorize(registration);

        _write(registration);

        IProgrammableExactShardsRegistryV1.LaunchStateV1 memory state = registry.launchState(registration.launchId);
        IProgrammableExactShardsRegistryV1.StoredFeePolicyV1 memory storedPolicy =
            registry.feePolicyState(registration.launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed));
        assertEq(state.feePolicyHash, policyHash);
        bytes32 feePolicyRecordHash = state.feePolicyRecordHash;
        assertEq(storedPolicy.policyHash, policyHash);
        assertEq(storedPolicy.feePolicyRecordHash, feePolicyRecordHash);
        assertEq(storedPolicy.verifierBindingHash, verifier.feePolicyBindingHashV2());
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

    function test_technicalApprovalPreexistsAndJitPermitBindsExactWebsiteMetadata() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory selected = _registration("metadata-bound");
        bytes32 technicalApprovalBinding = selected.approvalBindingHash;
        (, bytes32 permittedLaunchIntent,,) = bindingHarness.computeBindings(selected);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory technicalTemplate =
            _registration("metadata-bound");
        technicalTemplate.tokenNameHash = bytes32(0);
        technicalTemplate.tokenSymbolHash = bytes32(0);
        technicalTemplate.presentationBindingHash = bytes32(0);
        (bytes32 templateApprovalBinding,,,) = bindingHarness.computeBindings(technicalTemplate);
        assertEq(templateApprovalBinding, technicalApprovalBinding);
        _authorizeTechnical(technicalTemplate);
        assertEq(registry.approvalState(selected.approvalId).registrationBindingHash, technicalApprovalBinding);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory substituted = _registration("metadata-bound");
        substituted.tokenNameHash = keccak256(bytes("Substituted Shards"));
        substituted.tokenSymbolHash = keccak256(bytes("FAKE"));
        substituted.presentationBindingHash = _hash("substituted-description-image-links");
        substituted.websiteLaunchIdSha256 = _hash("substituted-public-website-launch-id");
        _rebindRecordOnly(substituted);

        // GitHub approval remains the same because it binds reviewed technical material, not UI values.
        (bytes32 substitutedApprovalBinding, bytes32 substitutedIntent,,) = bindingHarness.computeBindings(substituted);
        assertEq(substitutedApprovalBinding, technicalApprovalBinding);
        // The one-use just-in-time permit and final Registry record both bind the exact selected values.
        assertNotEq(substitutedIntent, permittedLaunchIntent);
        assertNotEq(substituted.registeredRecordCommitment, selected.registeredRecordCommitment);

        _authorizeLaunchIntent(selected);
        vm.expectPartialRevert(ProgrammableExactShardsRegistryV1.RegistrationBindingMismatch.selector);
        _write(substituted);
        assertFalse(registry.approvalConsumed(selected.approvalId));

        _write(selected);
        assertTrue(registry.approvalConsumed(selected.approvalId));
        assertEq(registry.launchState(selected.launchId).latestRecordHash, selected.registeredRecordCommitment);
        IProgrammableExactShardsRegistryV1.PublicIdentityStateV1 memory publicIdentity =
            registry.publicIdentityState(selected.launchId);
        assertEq(publicIdentity.websiteProjectIdSha256, selected.websiteProjectIdSha256);
        assertEq(publicIdentity.websiteLaunchIdSha256, selected.websiteLaunchIdSha256);
        assertEq(publicIdentity.identityMappingHash, _expectedPublicIdentityHash(selected));
    }

    function test_exactRegistryReceiptRetryIsIdempotentWhileRepositoryOnceLivesInPermitAuthority() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory first = _registration("repository-first");
        _register(first);
        bytes32 repositoryKey = permitAuthority.computeRepositoryKey(first.githubRepositoryId);
        assertNotEq(repositoryKey, bytes32(0));

        uint64 registrationsBeforeRetry = registry.registrationCount();
        uint64 transitionsBeforeRetry = registry.transitionCount();
        _write(first);
        assertEq(registry.registrationCount(), registrationsBeforeRetry);
        assertEq(registry.transitionCount(), transitionsBeforeRetry);

        // This contract deliberately has no independent lineage-consumption surface. The full atomic
        // route test proves that the shared Permit Authority permanently closes this numeric repository.
        assertEq(registry.launchState(first.launchId).latestRecordHash, first.registeredRecordCommitment);
    }

    function test_registrationGasStaysBelowHardMaximum() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration = _registration("gas-bound");
        _authorize(registration);

        uint256 gasBefore = gasleft();
        _write(registration);
        uint256 registrationGas = gasBefore - gasleft();

        assertLe(registrationGas, MAX_REGISTRATION_GAS);
    }

    function test_completeLifecycleFinalityImmutableRecordAndRevocation() public {
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
        assertEq(state.latestRecordRevision, 1);
        assertEq(state.latestRecordHash, registration.registeredRecordCommitment);
        assertEq(registry.recordHashAtRevision(registration.launchId, 1), registration.registeredRecordCommitment);
        assertEq(registry.recordHashAtRevision(registration.launchId, 2), bytes32(0));
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
        _write(wrongLeg);
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
        _write(wrongEconomics);
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
        _write(collapsed);
        assertFalse(registry.approvalConsumed(collapsed.approvalId));
    }

    function test_rejectsApprovalDeploymentEvidenceAndRegistryInstanceReplay() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory first = _registration("first");
        _register(first);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory approvalReplay = _registration("approval-replay");
        approvalReplay.approvalId = first.approvalId;
        _rebind(approvalReplay);
        vm.expectRevert(ProgrammableExactShardsRegistryV1.ApprovalAlreadyConsumed.selector);
        vm.prank(WRITER);
        registry.registerLaunch(approvalReplay);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory deploymentReplay =
            _registration("deployment-replay");
        deploymentReplay.deploymentId = first.deploymentId;
        _rebind(deploymentReplay);
        _authorize(deploymentReplay);
        vm.expectRevert(ProgrammableExactShardsRegistryV1.DeploymentAlreadyConsumed.selector);
        vm.prank(WRITER);
        registry.registerLaunch(deploymentReplay);

        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory evidenceReplay = _authorization(first);
        evidenceReplay.approvalId = _hash("fresh-approval-id");
        vm.expectRevert(ProgrammableExactShardsRegistryV1.EvidenceAlreadyConsumed.selector);
        vm.prank(APPROVER);
        registry.authorizeApproval(evidenceReplay);

        ProgrammableExactShardsRegistryV1 otherRegistry = _newRegistry(verifier);
        assertNotEq(otherRegistry.REGISTRY_INSTANCE_HASH(), registry.REGISTRY_INSTANCE_HASH());
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory copiedAuthorization = _authorization(first);
        vm.prank(APPROVER);
        otherRegistry.authorizeApproval(copiedAuthorization);
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory copiedIntent = _launchIntentAuthorization(first);
        vm.prank(INTENT_APPROVER);
        otherRegistry.authorizeLaunchIntent(copiedIntent);
        vm.expectPartialRevert(ProgrammableExactShardsRegistryV1.CanonicalIdentifierMismatch.selector);
        vm.prank(WRITER);
        otherRegistry.registerLaunch(first);
    }

    function test_rejectsAuthorizationMutationAndTerminalRevocation() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory mutation = _registration("mutation");
        _authorize(mutation);
        mutation.securityReviewHash = _hash("substituted-review");
        _rebindRecordOnly(mutation);
        vm.expectPartialRevert(ProgrammableExactShardsRegistryV1.ApprovalBindingMismatch.selector);
        _write(mutation);

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
        _write(revoked);
    }

    function test_rejectsApprovedSourceRouteProfileAndProviderDrift() public {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory sourceDrift = _registration("source-drift");
        _authorize(sourceDrift);
        sourceDrift.sourceCommitment = _hash("different-source");
        vm.expectRevert(ProgrammableExactShardsRegistryV1.InvalidBinding.selector);
        _write(sourceDrift);
        assertFalse(registry.approvalConsumed(sourceDrift.approvalId));

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory routeDrift = _registration("route-drift");
        _authorize(routeDrift);
        routeDrift.buildCommitment = _hash("different-route");
        vm.expectRevert(ProgrammableExactShardsRegistryV1.InvalidBinding.selector);
        _write(routeDrift);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory profileDrift = _registration("profile-drift");
        _authorize(profileDrift);
        profileDrift.marketPathId = _hash("different-profile");
        vm.expectRevert(ProgrammableExactShardsRegistryV1.InvalidBinding.selector);
        _write(profileDrift);

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory providerDrift = _registration("provider-drift");
        _authorize(providerDrift);
        providerDrift.providerId = _hash("unreviewed-provider");
        vm.expectRevert(ProgrammableExactShardsRegistryV1.InvalidBinding.selector);
        _write(providerDrift);
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

        IProgrammableCustomRegistryV1.FinalityProofV1 memory valid =
            _finalityProof(registration, _hash("canonical-100"), _hash("block-103"), _hash("valid-finality-evidence"));
        vm.prank(FINALIZER);
        registry.finalizeLaunch(valid);
        assertTrue(registry.transitionEvidenceConsumed(valid.finalityEvidenceHash));

        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory second = _registration("second-finality");
        second.githubRepositoryId = SHARDS_GITHUB_REPOSITORY_ID + 1;
        _retarget(second);
        _register(second);
        vm.roll(108);
        vm.setBlockhash(104, _hash("block-104"));
        vm.setBlockhash(107, _hash("block-107"));
        IProgrammableCustomRegistryV1.FinalityProofV1 memory replay =
            _finalityProof(second, _hash("block-104"), _hash("block-107"), valid.finalityEvidenceHash);
        replay.observedBlockNumber = 104;
        replay.confirmedHeadBlockNumber = 107;
        vm.expectRevert(ProgrammableExactShardsRegistryV1.EvidenceAlreadyConsumed.selector);
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
        vm.expectRevert(ProgrammableExactShardsRegistryV1.IncompatibleOperationalRoles.selector);
        vm.prank(ADMIN);
        registry.grantRole(writerRole, APPROVER);

        vm.expectRevert(ProgrammableExactShardsRegistryV1.SoleWriterIsImmutable.selector);
        vm.prank(ADMIN);
        registry.grantRole(writerRole, OUTSIDER);

        vm.expectRevert(ProgrammableExactShardsRegistryV1.SoleWriterIsImmutable.selector);
        vm.prank(ADMIN);
        registry.revokeRole(writerRole, WRITER);

        vm.expectRevert(ProgrammableExactShardsRegistryV1.SoleWriterIsImmutable.selector);
        vm.prank(WRITER);
        registry.renounceRole(writerRole, WRITER);
    }

    function testFuzz_constructorRejectsEveryPairwiseAuthorityRoleCollision(uint8 first, uint8 second) public {
        first = uint8(bound(first, 0, 5));
        second = uint8(bound(second, 0, 5));
        vm.assume(first != second);

        address collision = address(0xC0111D3);
        ProgrammableExactShardsRegistryV1.RegistryConfigV1 memory config = _config();
        _setAuthority(config, first, collision);
        _setAuthority(config, second, collision);

        vm.expectRevert(ProgrammableExactShardsRegistryV1.IncompatibleOperationalRoles.selector);
        new ProgrammableExactShardsRegistryV1(
            config, verifier, IProgrammableLaunchPermitAuthorityV1(address(permitAuthority))
        );
    }

    function test_roleHistoryAndDelayedDefaultAdminTransferCannotCollapseAuthorityClasses() public {
        bytes32 finalizerRole = keccak256("programmable.custom-registry.finalizer.v1");
        bytes32 intentApproverRole = keccak256("programmable.exact-shards-registry.launch-intent-approver.v1");

        vm.prank(ADMIN);
        registry.revokeRole(finalizerRole, FINALIZER);
        vm.expectRevert(ProgrammableExactShardsRegistryV1.IncompatibleOperationalRoles.selector);
        vm.prank(ADMIN);
        registry.grantRole(intentApproverRole, FINALIZER);

        vm.prank(ADMIN);
        registry.beginDefaultAdminTransfer(REVOKER);
        vm.warp(block.timestamp + 2 days + 1);
        vm.expectRevert(ProgrammableExactShardsRegistryV1.IncompatibleOperationalRoles.selector);
        vm.prank(REVOKER);
        registry.acceptDefaultAdminTransfer();

        assertEq(registry.defaultAdmin(), ADMIN);
        assertTrue(registry.hasRole(keccak256("programmable.custom-registry.revoker.v1"), REVOKER));
    }

    function test_initialAndSuccessorDefaultAdminsCanNeverAcquireOperationalAuthority() public {
        bytes32 finalizerRole = keccak256("programmable.custom-registry.finalizer.v1");
        ProgrammableExactShardsRegistryV1.RegistryConfigV1 memory invalid = _config();
        invalid.initialFinalizer = ADMIN;
        vm.expectRevert(ProgrammableExactShardsRegistryV1.IncompatibleOperationalRoles.selector);
        new ProgrammableExactShardsRegistryV1(
            invalid, verifier, IProgrammableLaunchPermitAuthorityV1(address(permitAuthority))
        );

        vm.expectRevert(ProgrammableExactShardsRegistryV1.IncompatibleOperationalRoles.selector);
        vm.prank(ADMIN);
        registry.grantRole(finalizerRole, ADMIN);

        address successorAdmin = address(0xAD11);
        vm.prank(ADMIN);
        registry.beginDefaultAdminTransfer(successorAdmin);
        vm.warp(block.timestamp + 2 days + 1);
        vm.prank(successorAdmin);
        registry.acceptDefaultAdminTransfer();

        vm.expectRevert(ProgrammableExactShardsRegistryV1.IncompatibleOperationalRoles.selector);
        vm.prank(successorAdmin);
        registry.grantRole(finalizerRole, ADMIN);

        vm.expectRevert(ProgrammableExactShardsRegistryV1.IncompatibleOperationalRoles.selector);
        vm.prank(successorAdmin);
        registry.grantRole(finalizerRole, successorAdmin);
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
        verifier.verify(registration.feePolicy, registration.orderedFeeLegs);
    }

    function _newRegistry(ProgrammableExactShardsFeePolicyVerifierV2 verifier_)
        private
        returns (ProgrammableExactShardsRegistryV1)
    {
        return new ProgrammableExactShardsRegistryV1(
            _config(), verifier_, IProgrammableLaunchPermitAuthorityV1(address(permitAuthority))
        );
    }

    function _config() private pure returns (ProgrammableExactShardsRegistryV1.RegistryConfigV1 memory config) {
        config = ProgrammableExactShardsRegistryV1.RegistryConfigV1({
            initialAdminDelay: 2 days,
            initialAdmin: ADMIN,
            initialApprover: APPROVER,
            initialLaunchIntentApprover: INTENT_APPROVER,
            initialWriter: WRITER,
            initialFinalizer: FINALIZER,
            initialRevoker: REVOKER,
            registryGeneration: GENERATION,
            minimumFinalityBlocks: FINALITY_BLOCKS,
            chainProfileHash: _hash("ethereum-mainnet-chain-profile"),
            registryPolicyHash: _hash("exact-shards-registry-policy")
        });
    }

    function _setAuthority(
        ProgrammableExactShardsRegistryV1.RegistryConfigV1 memory config,
        uint8 roleClass,
        address account
    ) private pure {
        if (roleClass == 0) config.initialAdmin = account;
        else if (roleClass == 1) config.initialApprover = account;
        else if (roleClass == 2) config.initialLaunchIntentApprover = account;
        else if (roleClass == 3) config.initialWriter = account;
        else if (roleClass == 4) config.initialFinalizer = account;
        else config.initialRevoker = account;
    }

    function _registration(string memory label)
        private
        view
        returns (IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration.chainId = block.chainid;
        registration.registryGeneration = GENERATION;
        registration.githubRepositoryId = SHARDS_GITHUB_REPOSITORY_ID;
        registration.approvalGeneration = 1;
        registration.commitId = bytes32(bytes20(hex"91b38f3de64d96cac7e29f127c004f128fc1da59"));
        registration.sourceCommitment = verifier.SOURCE_REVISION_HASH();
        registration.buildCommitment = verifier.REVIEWED_TECHNICAL_BUILD_SHA256();
        registration.artifactSetHash = _hash(string.concat(label, "-artifact-set"));
        registration.deploymentConfigurationHash = _hash(string.concat(label, "-deployment-configuration"));
        registration.configurationHash = _hash(string.concat(label, "-configuration"));
        registration.projectId = bindingHarness.computeProjectId(registration.githubRepositoryId);
        registration.websiteProjectIdSha256 = 0xe33d0fb2770fef54416133287dac2bc43bdb88a0391775b07ce19287039035c2;
        registration.websiteLaunchIdSha256 = 0xb87d5eac727a56d93f9f53a8f02f54dc1a67b3bca2f00694ec46d1f83500cc26;
        registration.tokenNameHash = keccak256(bytes("Shards"));
        registration.tokenSymbolHash = keccak256(bytes("SHARDS"));
        registration.presentationBindingHash = _hash(string.concat(label, "-description-image-links"));
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
        registration.feePolicy.feeAsset = address(0);
        registration.feePolicy.feeBasisHash = verifier.FEE_BASIS_HASH();
        registration.feePolicy.totalFeeBps = verifier.TOTAL_FEE_BPS();
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
            recipient: address(runtimeTarget),
            recipientModeHash: verifier.HOLDER_RECIPIENT_MODE_HASH()
        });
        registration.feePolicy.legsHash = keccak256(
            abi.encode(
                verifier.hashLeg(registration.orderedFeeLegs[0]),
                verifier.hashLeg(registration.orderedFeeLegs[1]),
                verifier.hashLeg(registration.orderedFeeLegs[2])
            )
        );
        (registration.approvalBindingHash,,,) = bindingHarness.computeBindings(registration);
        (registration.approvalId, registration.launchId) = bindingHarness.computeCanonicalTargetIds(
            registration.projectId, registration.approvalGeneration, registration.approvalBindingHash
        );
        _rebindRecordOnly(registration);
    }

    function _rebind(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private view {
        (registration.approvalBindingHash,,,) = bindingHarness.computeBindings(registration);
        (,, registration.reviewDeploymentBindingHash,) = bindingHarness.computeBindings(registration);
        (,,, registration.registeredRecordCommitment) = bindingHarness.computeBindings(registration);
    }

    function _retarget(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private view {
        registration.projectId = bindingHarness.computeProjectId(registration.githubRepositoryId);
        (registration.approvalBindingHash,,,) = bindingHarness.computeBindings(registration);
        (registration.approvalId, registration.launchId) = bindingHarness.computeCanonicalTargetIds(
            registration.projectId, registration.approvalGeneration, registration.approvalBindingHash
        );
        _rebindRecordOnly(registration);
    }

    function _rebindRecordOnly(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
    {
        (,, registration.reviewDeploymentBindingHash,) = bindingHarness.computeBindings(registration);
        (,,, registration.registeredRecordCommitment) = bindingHarness.computeBindings(registration);
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
            registrationBindingHash: registration.approvalBindingHash,
            validAfterBlock: uint64(block.number),
            expiresAtBlock: type(uint64).max,
            evidenceHash: keccak256(abi.encode("approval-evidence", registration.approvalId))
        });
    }

    function _launchIntentAuthorization(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
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
            registrationBindingHash: _launchIntentBinding(registration),
            validAfterBlock: uint64(block.number),
            expiresAtBlock: uint64(block.number + 200),
            evidenceHash: keccak256(abi.encode("launch-intent-evidence", registration.approvalId))
        });
    }

    function _launchIntentBinding(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (bytes32 bindingHash)
    {
        (, bindingHash,,) = bindingHarness.computeBindings(registration);
    }

    function _expectedPublicIdentityHash(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256(
                    "ExactShardsPublicIdentityBindingV1(bytes32 websiteProjectIdSha256,bytes32 websiteLaunchIdSha256,bytes32 registryProjectId,bytes32 registryApprovalId,bytes32 registryLaunchId,uint64 githubRepositoryId,uint64 approvalGeneration,uint256 chainId,address registry,uint64 registryGeneration,bytes32 routeId,address primaryContract)"
                ),
                registration.websiteProjectIdSha256,
                registration.websiteLaunchIdSha256,
                registration.projectId,
                registration.approvalId,
                registration.launchId,
                registration.githubRepositoryId,
                registration.approvalGeneration,
                registration.chainId,
                address(registry),
                registration.registryGeneration,
                keccak256("programmable.exact-shards.atomic-launch-route.v1"),
                registration.primaryContract
            )
        );
    }

    function _authorizeTechnical(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private {
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory authorization = _authorization(registration);
        vm.prank(APPROVER);
        registry.authorizeApproval(authorization);
    }

    function _authorizeLaunchIntent(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
    {
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory authorization =
            _launchIntentAuthorization(registration);
        vm.prank(INTENT_APPROVER);
        registry.authorizeLaunchIntent(authorization);
    }

    function _authorize(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private {
        _authorizeTechnical(registration);
        _authorizeLaunchIntent(registration);
    }

    function _register(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private {
        _authorize(registration);
        _write(registration);
    }

    function _write(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private {
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
