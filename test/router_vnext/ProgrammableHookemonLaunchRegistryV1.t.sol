// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import {
    ProgrammableLaunchPermitAuthorityV1
} from "../../dependencies/shards-launch-permit-8afe4548553b406bd0374b3a8958f1a186104b11/ProgrammableLaunchPermitAuthorityV1.sol";
import {
    ProgrammableLaunchPermitVerifierV1
} from "../../dependencies/shards-launch-permit-8afe4548553b406bd0374b3a8958f1a186104b11/ProgrammableLaunchPermitVerifierV1.sol";
import {
    IProgrammableLaunchPermitAuthorityV1
} from "../../dependencies/shards-launch-permit-8afe4548553b406bd0374b3a8958f1a186104b11/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import {
    IProgrammablePermitBoundRouteV1
} from "../../dependencies/shards-launch-permit-8afe4548553b406bd0374b3a8958f1a186104b11/interfaces/IProgrammablePermitBoundRouteV1.sol";
import {
    IProgrammableHookemonLaunchRegistryV1
} from "../../src/router_vnext/IProgrammableHookemonLaunchRegistryV1.sol";
import { ProgrammableHookemonLaunchRegistryV1 } from "../../src/router_vnext/ProgrammableHookemonLaunchRegistryV1.sol";
import {
    IProgrammableExactHookemonLauncherCodeStoreV1
} from "../../src/router_vnext/IProgrammableExactHookemonNormalCreateProfileV1.sol";
import { IProgrammableUniversalLaunchKernelV1 } from "../../src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol";
import { ProgrammableUniversalLaunchKernelV1 } from "../../src/router_vnext/ProgrammableUniversalLaunchKernelV1.sol";
import {
    ProgrammableUniversalLaunchPreflightV1
} from "../../src/router_vnext/ProgrammableUniversalLaunchPreflightV1.sol";
import {
    ProgrammableExactHookemonLauncherCodeStoreV1
} from "../../src/router_vnext/ProgrammableExactHookemonLauncherCodeStoreV1.sol";
import {
    ProgrammableExactHookemonPostconditionVerifierV2
} from "../../src/router_vnext/ProgrammableExactHookemonPostconditionVerifierV1.sol";
import {
    ProgrammableExactHookemonReusablePlanModuleV2
} from "../../src/router_vnext/ProgrammableExactHookemonReusablePlanModuleV2.sol";
import {
    ProgrammableExactHookemonReusableNormalCreateProfileV2
} from "../../src/router_vnext/ProgrammableExactHookemonReusableNormalCreateProfileV2.sol";

contract HookemonRegistryComponentV1 { }

contract HookemonKernelAuthorityHarnessV2 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }

    function registerProfile(
        ProgrammableUniversalLaunchKernelV1 kernel,
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 calldata descriptor
    ) external {
        kernel.registerProfileV1(descriptor);
    }
}

/// @dev Release-compatible route harness. It uses the exact frozen Authority and the real Hookemon Registry.
contract HookemonPermitRouteHarnessV1 is IProgrammablePermitBoundRouteV1 {
    IProgrammableLaunchPermitAuthorityV1 public immutable AUTHORITY;
    bytes32 public immutable override ROUTE_ID;
    bytes32 public immutable PROFILE_ID;
    bytes32 public immutable PROFILE_BINDING_HASH;
    bytes32 public immutable EXECUTION_AUTHORITY_HASH;
    address private immutable OWNER;
    IProgrammableHookemonLaunchRegistryV1 private _registry;

    error AlreadyBound();
    error IntentionalRollback();
    error Unauthorized();

    constructor(
        IProgrammableLaunchPermitAuthorityV1 authority,
        bytes32 routeId,
        bytes32 profileId,
        bytes32 profileBindingHash,
        bytes32 executionAuthorityHash
    ) {
        AUTHORITY = authority;
        ROUTE_ID = routeId;
        PROFILE_ID = profileId;
        PROFILE_BINDING_HASH = profileBindingHash;
        EXECUTION_AUTHORITY_HASH = executionAuthorityHash;
        OWNER = msg.sender;
    }

    function bindRegistry(IProgrammableHookemonLaunchRegistryV1 registry) external {
        if (msg.sender != OWNER) revert Unauthorized();
        if (address(_registry) != address(0) || address(registry) == address(0)) revert AlreadyBound();
        _registry = registry;
    }

    function consumeAndRegister(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        bytes calldata signature,
        IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 calldata registration
    ) external {
        _consumeAndRegister(permit, releaseBinding, kernelEnvelope, signature, registration);
    }

    function consumeAndRegisterThenRevert(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        bytes calldata signature,
        IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 calldata registration
    ) external {
        _consumeAndRegister(permit, releaseBinding, kernelEnvelope, signature, registration);
        revert IntentionalRollback();
    }

    function consumeOnly(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        bytes calldata signature
    ) external {
        AUTHORITY.consumePermit(permit, releaseBinding, kernelEnvelope, signature, _actual(permit));
    }

    function permitProfile() external view returns (address) {
        return address(this);
    }

    function permitProfileId() external view returns (bytes32) {
        return PROFILE_ID;
    }

    function permitProfileBindingHash() external view returns (bytes32) {
        return PROFILE_BINDING_HASH;
    }

    function permitLaunchRegistry() external view returns (address) {
        return address(_registry);
    }

    function permitKernelEnvelopeMode()
        external
        pure
        returns (IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1)
    {
        return IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.REQUIRED;
    }

    function permitExecutionAuthorityHash() external view returns (bytes32) {
        return EXECUTION_AUTHORITY_HASH;
    }

    function _consumeAndRegister(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        bytes calldata signature,
        IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 calldata registration
    ) private {
        AUTHORITY.consumePermit(permit, releaseBinding, kernelEnvelope, signature, _actual(permit));
        _registry.registerLaunchFromConsumedPermitV1(registration);
    }

    function _actual(IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit)
        private
        pure
        returns (IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1 memory)
    {
        return IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1({
            applicantWallet: permit.applicantWallet,
            executionCoreHash: permit.executionCoreHash,
            executionCalldataKeccak256: permit.executionCalldataKeccak256,
            executionValue: permit.executionValue
        });
    }
}

    contract ProgrammableHookemonLaunchRegistryV1Test is Test {
        uint256 private constant SIGNER_KEY = 0xA11CE;
        address private constant SIGNER_GOVERNOR = address(0x1001);
        address private constant RELEASE_GOVERNOR = address(0x1002);
        address private constant PAUSER = address(0x1003);
        address private constant CANCELLER = address(0x1004);
        address private constant APPLICANT = address(0xA9911CA7);
        uint64 private constant HOOKEMON_GITHUB_REPOSITORY_ID = 1_324_982_531;
        bytes32 private constant ROUTE_ID = keccak256("PROGRAMMABLE_ROUTE:HOOKEMON:EXACT_REUSABLE_NORMAL_CREATE:v2");
        bytes32 private constant PROFILE_ID = keccak256("HOOKEMON:EXACT_REUSABLE_NORMAL_CREATE:v2");
        bytes32 private constant PROFILE_BINDING_HASH = keccak256("hookemon-profile-binding-v2");
        bytes32 private constant EXECUTION_AUTHORITY_HASH = keccak256("hookemon-execution-authority-v2");
        bytes32 private constant CHAIN_PROFILE_HASH = keccak256("hookemon-chain-profile-v1");
        bytes32 private constant REVENUE_BINDING_HASH = keccak256(
            "HookemonInclusiveQuoteFeeV1(totalHundredthsOfBip=30000,projectHundredthsOfBip=29000,programmableHundredthsOfBip=1000,programmableFeeOwner=0x4957f49620AFf3Adbbe8195a4f633E49cc93376c,lpFeePips=3000,lpFeeSeparate=true,externalAdditiveFee=false)"
        );

        struct ReleaseFixture {
            HookemonPermitRouteHarnessV1 route;
            ProgrammableHookemonLaunchRegistryV1 registry;
            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 releaseBinding;
        }

        ProgrammableLaunchPermitVerifierV1 private verifier;
        ProgrammableLaunchPermitAuthorityV1 private authority;
        ReleaseFixture private primary;
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 private kernelEnvelope;
        HookemonRegistryComponentV1[5] private components;

        function setUp() public {
            vm.warp(1_000_000);
            vm.roll(1000);
            verifier = new ProgrammableLaunchPermitVerifierV1();
            authority = new ProgrammableLaunchPermitAuthorityV1(
                1,
                address(this),
                SIGNER_GOVERNOR,
                RELEASE_GOVERNOR,
                PAUSER,
                CANCELLER,
                vm.addr(SIGNER_KEY),
                900,
                verifier,
                address(verifier).codehash
            );
            primary = _deployRelease(ROUTE_ID, PROFILE_ID, PROFILE_BINDING_HASH, EXECUTION_AUTHORITY_HASH, 1, 1);
            kernelEnvelope = IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1({
                kernelGrantDigest: keccak256("kernel-grant"),
                reviewerCurrentnessDigest: keccak256("reviewer-currentness"),
                applicantWalletIntentDigest: keccak256("applicant-wallet-intent")
            });
            for (uint256 i; i < components.length; ++i) {
                components[i] = new HookemonRegistryComponentV1();
            }
        }

        function testExactFrozenAuthorityConsumesAndRealRegistryRecordsAtomically() external {
            (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit, bytes memory signature) =
                _signedPermit(primary, HOOKEMON_GITHUB_REPOSITORY_ID, 1, keccak256("hookemon-launch"));
            IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 memory registration;
            registration = _registration(primary, permit);

            primary.route.consumeAndRegister(permit, primary.releaseBinding, kernelEnvelope, signature, registration);

            bytes32 repositoryKey = authority.computeRepositoryKey(HOOKEMON_GITHUB_REPOSITORY_ID);
            bytes32 permitDigest = authority.hashPermit(permit);
            IProgrammableLaunchPermitAuthorityV1.RepositoryConsumptionV1 memory consumption =
                authority.repositoryConsumption(repositoryKey);
            IProgrammableHookemonLaunchRegistryV1.LaunchStateV1 memory launch =
                primary.registry.launchState(permit.launchId);
            assertEq(consumption.route, address(primary.route));
            assertEq(consumption.permitDigest, permitDigest);
            assertEq(consumption.consumedAtBlock, block.number);
            assertTrue(launch.registered);
            assertEq(launch.repositoryKey, repositoryKey);
            assertEq(primary.registry.registrationCount(), 1);
            assertEq(primary.registry.launchIdByRepositoryKey(repositoryKey), permit.launchId);
            assertEq(primary.registry.launchIdByPermitDigest(permitDigest), permit.launchId);
            assertEq(primary.registry.HOOKEMON_REVENUE_BINDING_HASH(), REVENUE_BINDING_HASH);
            assertEq(primary.registry.hookemonGraphState(permit.launchId).revenueBindingHash, REVENUE_BINDING_HASH);
        }

        function testRouteRevertRollsBackAuthorityConsumptionAndRegistryRecord() external {
            uint64 repositoryId = HOOKEMON_GITHUB_REPOSITORY_ID + 1;
            (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit, bytes memory signature) =
                _signedPermit(primary, repositoryId, 2, keccak256("rollback-launch"));
            IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 memory registration;
            registration = _registration(primary, permit);
            bytes32 repositoryKey = authority.computeRepositoryKey(repositoryId);

            vm.expectRevert(HookemonPermitRouteHarnessV1.IntentionalRollback.selector);
            primary.route
                .consumeAndRegisterThenRevert(permit, primary.releaseBinding, kernelEnvelope, signature, registration);

            assertFalse(authority.repositoryConsumed(repositoryKey));
            assertEq(authority.nextNonce(repositoryKey), 0);
            assertFalse(primary.registry.launchState(permit.launchId).registered);
            assertEq(primary.registry.registrationCount(), 0);

            primary.route.consumeAndRegister(permit, primary.releaseBinding, kernelEnvelope, signature, registration);
            assertTrue(authority.repositoryConsumed(repositoryKey));
            assertTrue(primary.registry.launchState(permit.launchId).registered);
        }

        function testRepositoryConsumptionIsPermanentAcrossRoutesAndReleaseGenerations() external {
            (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory first, bytes memory firstSignature) =
                _signedPermit(primary, HOOKEMON_GITHUB_REPOSITORY_ID, 1, keccak256("first-route"));
            primary.route
                .consumeAndRegister(
                    first, primary.releaseBinding, kernelEnvelope, firstSignature, _registration(primary, first)
                );

            ReleaseFixture memory secondary = _deployRelease(
                keccak256("HOOKEMON:ALTERNATE:ROUTE"),
                keccak256("HOOKEMON:ALTERNATE:PROFILE"),
                keccak256("alternate-profile-binding"),
                keccak256("alternate-execution-authority"),
                2,
                2
            );
            (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory second, bytes memory secondSignature) =
                _signedPermit(secondary, HOOKEMON_GITHUB_REPOSITORY_ID, 2, keccak256("second-route"));

            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.RepositoryAlreadyConsumed.selector);
            secondary.route.consumeOnly(second, secondary.releaseBinding, kernelEnvelope, secondSignature);
            assertEq(authority.consumptionCount(), 1);
            assertEq(
                authority.repositoryConsumption(first.repositoryKey).route,
                address(primary.route),
                "first route remains the permanent lineage"
            );
        }

        function testCancelledPermitAndApprovalGenerationCannotRegister() external {
            uint64 cancelledRepositoryId = HOOKEMON_GITHUB_REPOSITORY_ID + 2;
            (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit, bytes memory signature) =
                _signedPermit(primary, cancelledRepositoryId, 3, keccak256("cancelled-permit"));
            IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 memory cancelledRegistration =
                _registration(primary, permit);
            vm.prank(CANCELLER);
            authority.cancelPermit(permit, primary.releaseBinding, kernelEnvelope, keccak256("cancelled"));
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.PermitAlreadyCancelled.selector);
            primary.route
                .consumeAndRegister(permit, primary.releaseBinding, kernelEnvelope, signature, cancelledRegistration);

            uint64 revokedRepositoryId = HOOKEMON_GITHUB_REPOSITORY_ID + 3;
            vm.prank(CANCELLER);
            authority.cancelApprovalGeneration(revokedRepositoryId, 1, keccak256("approval-revoked"));
            (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory revoked, bytes memory revokedSignature) =
                _signedPermit(primary, revokedRepositoryId, 4, keccak256("revoked-approval"));
            IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 memory revokedRegistration =
                _registration(primary, revoked);
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.ApprovalGenerationIsCancelled.selector);
            primary.route
                .consumeAndRegister(
                    revoked, primary.releaseBinding, kernelEnvelope, revokedSignature, revokedRegistration
                );
        }

        function testRegistryHasExactlyOneImmutableWriterAndNoPerLaunchApprover() external {
            assertTrue(primary.registry.hasRole(primary.registry.WRITER_ROLE(), address(primary.route)));
            assertEq(primary.registry.LAUNCH_ROUTE(), address(primary.route));
            assertEq(primary.registry.LAUNCH_PERMIT_AUTHORITY(), address(authority));
            bytes32 writerRole = primary.registry.WRITER_ROLE();
            vm.expectPartialRevert(ProgrammableHookemonLaunchRegistryV1.WriterRoleRestricted.selector);
            primary.registry.grantRole(writerRole, address(components[0]));
            assertFalse(primary.registry.hasRole(primary.registry.WRITER_ROLE(), address(components[0])));
        }

        function testRegistrationFailsUnlessConsumptionAndRegistrationShareTheSameTransaction() external {
            (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit, bytes memory signature) =
                _signedPermit(primary, HOOKEMON_GITHUB_REPOSITORY_ID + 4, 5, keccak256("stale-consumption"));
            IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 memory registration;
            registration = _registration(primary, permit);
            primary.route.consumeOnly(permit, primary.releaseBinding, kernelEnvelope, signature);
            vm.roll(block.number + 1);
            vm.prank(address(primary.route));
            vm.expectPartialRevert(ProgrammableHookemonLaunchRegistryV1.PermitNotConsumed.selector);
            primary.registry.registerLaunchFromConsumedPermitV1(registration);
        }

        function testActualProfileDeploysWithoutRegistryRuntimeHashCycleAndActivatesExactSharedRelease() external {
            ProgrammableUniversalLaunchPreflightV1 preflight = new ProgrammableUniversalLaunchPreflightV1();
            HookemonKernelAuthorityHarnessV2 reviewer = new HookemonKernelAuthorityHarnessV2();
            HookemonKernelAuthorityHarnessV2 governance = new HookemonKernelAuthorityHarnessV2();
            HookemonKernelAuthorityHarnessV2 finality = new HookemonKernelAuthorityHarnessV2();
            HookemonKernelAuthorityHarnessV2 indexer = new HookemonKernelAuthorityHarnessV2();
            IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control =
                IProgrammableUniversalLaunchKernelV1.ControlStateV1({
                    securityControlHeadHash: keccak256("security-head"),
                    securityEpoch: 1,
                    securityEpochHash: keccak256("security-epoch"),
                    policyEpoch: 1,
                    policyEpochHash: keccak256("policy-epoch"),
                    reviewGeneration: 1,
                    reviewGenerationHash: keccak256("review-generation"),
                    globalKilled: false
                });
            ProgrammableUniversalLaunchKernelV1 kernel = new ProgrammableUniversalLaunchKernelV1(
                address(reviewer),
                address(reviewer).codehash,
                address(governance),
                address(governance).codehash,
                address(finality),
                address(finality).codehash,
                address(indexer),
                address(indexer).codehash,
                address(preflight),
                address(preflight).codehash,
                control
            );
            ProgrammableExactHookemonLauncherCodeStoreV1 codeStore =
                new ProgrammableExactHookemonLauncherCodeStoreV1(address(components[0]), address(components[1]));
            ProgrammableExactHookemonPostconditionVerifierV2 postconditionVerifier =
                new ProgrammableExactHookemonPostconditionVerifierV2();
            ProgrammableExactHookemonReusablePlanModuleV2 planModule = new ProgrammableExactHookemonReusablePlanModuleV2();

            uint256 nextNonce = vm.getNonce(address(this));
            address predictedProfile = vm.computeCreateAddress(address(this), nextNonce + 1);
            ProgrammableHookemonLaunchRegistryV1 registry = new ProgrammableHookemonLaunchRegistryV1(
                ProgrammableHookemonLaunchRegistryV1.DeploymentConfigV1({
                    initialAdminDelay: 1,
                    initialAdmin: address(this),
                    launchPermitAuthority: authority,
                    launchPermitAuthorityRuntimeCodeHash: address(authority).codehash,
                    registryGeneration: 2,
                    chainProfileHash: CHAIN_PROFILE_HASH,
                    route: predictedProfile,
                    routeId: ROUTE_ID,
                    profileId: PROFILE_ID,
                    hookemonRevenueBindingHash: REVENUE_BINDING_HASH
                })
            );
            ProgrammableExactHookemonReusableNormalCreateProfileV2 profile = new ProgrammableExactHookemonReusableNormalCreateProfileV2(
                ProgrammableExactHookemonReusableNormalCreateProfileV2.DeploymentConfigV2({
                    kernel: kernel,
                    kernelRuntimeCodeHash: address(kernel).codehash,
                    codeStore: IProgrammableExactHookemonLauncherCodeStoreV1(address(codeStore)),
                    codeStoreRuntimeCodeHash: address(codeStore).codehash,
                    codeStoreBindingHash: codeStore.runtimeBindingHashV1(),
                    postconditionVerifier: postconditionVerifier,
                    postconditionVerifierRuntimeCodeHash: address(postconditionVerifier).codehash,
                    verifierBindingHash: postconditionVerifier.runtimeBindingHashV1(),
                    planModule: planModule,
                    planModuleRuntimeCodeHash: address(planModule).codehash,
                    planModuleBindingHash: planModule.MODULE_BINDING_HASH(),
                    permitAuthority: authority,
                    permitAuthorityRuntimeCodeHash: address(authority).codehash,
                    launchRegistry: registry,
                    launchRegistryRuntimeCodeHash: address(registry).codehash,
                    launchRegistryBindingHash: registry.runtimeBindingHashV1(),
                    expectedLauncherCreationCodeHash: codeStore.creationCodeHashV1(),
                    expectedLauncherCreationCodeLength: codeStore.creationCodeLengthV1(),
                    verifierGasLimit: 1_000_000
                })
            );
            assertEq(address(profile), predictedProfile);
            assertEq(profile.permitProfile(), address(profile));
            assertEq(profile.permitLaunchRegistry(), address(registry));
            assertEq(profile.permitProfileId(), PROFILE_ID);
            assertEq(
                uint8(profile.permitKernelEnvelopeMode()),
                uint8(IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.REQUIRED)
            );

            authority.grantRole(authority.CONSUMER_ROLE(), address(profile));
            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory binding =
                IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1({
                    authorityGeneration: authority.AUTHORITY_GENERATION(),
                    releaseGeneration: 2,
                    permitAuthority: address(authority),
                    permitAuthorityRuntimeCodeHash: address(authority).codehash,
                    launchRegistry: address(registry),
                    launchRegistryGeneration: registry.REGISTRY_GENERATION(),
                    launchRegistryRuntimeCodeHash: address(registry).codehash,
                    chainProfileHash: registry.CHAIN_PROFILE_HASH(),
                    profile: address(profile),
                    profileId: profile.permitProfileId(),
                    profileRuntimeCodeHash: address(profile).codehash,
                    profileBindingHash: profile.permitProfileBindingHash(),
                    route: address(profile),
                    routeId: profile.ROUTE_ID(),
                    routeRuntimeCodeHash: address(profile).codehash,
                    executionAuthorityHash: profile.permitExecutionAuthorityHash(),
                    kernelEnvelopeMode: profile.permitKernelEnvelopeMode()
                });
            vm.prank(RELEASE_GOVERNOR);
            bytes32 bindingHash = authority.activateReleaseBinding(binding);
            assertTrue(authority.releaseStatus(bindingHash).active);
            assertEq(authority.releaseBindingHashByGeneration(2), bindingHash);
            assertEq(registry.LAUNCH_ROUTE(), address(profile));
            assertTrue(registry.hasRole(registry.WRITER_ROLE(), address(profile)));
            assertLe(address(profile).code.length, 22_000, "profile exceeds reviewed Kernel scan envelope");

            uint256 registrationGasUsed = _registerProfileAndMeasure(governance, kernel, profile, control);
            emit log_named_uint("actual Kernel profile registration gas", registrationGasUsed);
            assertLe(registrationGasUsed, 8_200_000, "Kernel registration gas regression");
            assertEq(kernel.profileDescriptorV1(PROFILE_ID).module, address(profile));
            assertEq(profile.runtimeBindingHashV1(), profile.PROVIDER_BINDING_HASH());
        }

        function _registerProfileAndMeasure(
            HookemonKernelAuthorityHarnessV2 governance,
            ProgrammableUniversalLaunchKernelV1 kernel,
            ProgrammableExactHookemonReusableNormalCreateProfileV2 profile,
            IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control
        ) private returns (uint256 registrationGasUsed) {
            uint256 registrationGasBefore = gasleft();
            governance.registerProfile(kernel, _activeProfileDescriptor(profile, control));
            registrationGasUsed = registrationGasBefore - gasleft();
        }

        function _activeProfileDescriptor(
            ProgrammableExactHookemonReusableNormalCreateProfileV2 profile,
            IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control
        ) private view returns (IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory) {
            return IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1({
                profileKey: PROFILE_ID,
                schemaId: keccak256("EXACT_HOOKEMON_REUSABLE_NORMAL_CREATE_SCHEMA_V2"),
                profileVersion: 2,
                capabilitySemantics: IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute,
                module: address(profile),
                moduleRuntimeCodeHash: address(profile).codehash,
                actionTypeHash: profile.PLAN_TYPEHASH(),
                exactContractBindingHash: profile.EXACT_CONTRACT_BINDING_HASH(),
                providerBindingHash: profile.PROVIDER_BINDING_HASH(),
                revenuePolicyHash: profile.REVENUE_POLICY_HASH(),
                securityControlHeadHash: control.securityControlHeadHash,
                securityEpoch: control.securityEpoch,
                securityEpochHash: control.securityEpochHash,
                policyEpoch: control.policyEpoch,
                policyEpochHash: control.policyEpochHash,
                reviewGeneration: control.reviewGeneration,
                reviewGenerationHash: control.reviewGenerationHash,
                status: IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active
            });
        }

        function _deployRelease(
            bytes32 routeId,
            bytes32 profileId,
            bytes32 profileBindingHash,
            bytes32 executionAuthorityHash,
            uint64 registryGeneration,
            uint64 releaseGeneration
        ) private returns (ReleaseFixture memory fixture) {
            fixture.route = new HookemonPermitRouteHarnessV1(
                authority, routeId, profileId, profileBindingHash, executionAuthorityHash
            );
            fixture.registry = new ProgrammableHookemonLaunchRegistryV1(
                ProgrammableHookemonLaunchRegistryV1.DeploymentConfigV1({
                    initialAdminDelay: 1,
                    initialAdmin: address(this),
                    launchPermitAuthority: authority,
                    launchPermitAuthorityRuntimeCodeHash: address(authority).codehash,
                    registryGeneration: registryGeneration,
                    chainProfileHash: CHAIN_PROFILE_HASH,
                    route: address(fixture.route),
                    routeId: routeId,
                    profileId: profileId,
                    hookemonRevenueBindingHash: REVENUE_BINDING_HASH
                })
            );
            fixture.route.bindRegistry(fixture.registry);
            authority.grantRole(authority.CONSUMER_ROLE(), address(fixture.route));
            fixture.releaseBinding = IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1({
                authorityGeneration: authority.AUTHORITY_GENERATION(),
                releaseGeneration: releaseGeneration,
                permitAuthority: address(authority),
                permitAuthorityRuntimeCodeHash: address(authority).codehash,
                launchRegistry: address(fixture.registry),
                launchRegistryGeneration: registryGeneration,
                launchRegistryRuntimeCodeHash: address(fixture.registry).codehash,
                chainProfileHash: CHAIN_PROFILE_HASH,
                profile: address(fixture.route),
                profileId: profileId,
                profileRuntimeCodeHash: address(fixture.route).codehash,
                profileBindingHash: profileBindingHash,
                route: address(fixture.route),
                routeId: routeId,
                routeRuntimeCodeHash: address(fixture.route).codehash,
                executionAuthorityHash: executionAuthorityHash,
                kernelEnvelopeMode: IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.REQUIRED
            });
            vm.prank(RELEASE_GOVERNOR);
            authority.activateReleaseBinding(fixture.releaseBinding);
        }

        function _signedPermit(
            ReleaseFixture memory fixture,
            uint64 repositoryId,
            uint64 permitGeneration,
            bytes32 launchId
        )
            private
            view
            returns (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit, bytes memory signature)
        {
            permit.githubRepositoryId = repositoryId;
            permit.approvalGeneration = 1;
            permit.permitGeneration = permitGeneration;
            permit.notBefore = uint64(block.timestamp);
            permit.deadline = uint64(block.timestamp + 300);
            permit.signerEpoch = authority.currentSignerEpoch();
            permit.repositoryKey = authority.computeRepositoryKey(repositoryId);
            permit.nonce = authority.nextNonce(permit.repositoryKey);
            permit.chainId = block.chainid;
            permit.route = address(fixture.route);
            permit.routeId = fixture.route.ROUTE_ID();
            permit.applicantWallet = APPLICANT;
            permit.launchId = launchId;
            permit.approvalId = keccak256(abi.encode("hookemon-technical-approval", repositoryId));
            permit.technicalApprovalHash = keccak256(abi.encode("hookemon-technical-config", repositoryId));
            permit.descriptorHash = keccak256(abi.encode("website-descriptor", launchId));
            permit.presentationBindingHash = keccak256(abi.encode("website-presentation", launchId));
            permit.configurationHash = keccak256(abi.encode("durable-config", launchId));
            permit.walletOwnershipBindingHash = keccak256(abi.encode("wallet", APPLICANT));
            permit.executionPlanHash = keccak256(abi.encode("execution-plan", launchId));
            permit.executionCoreHash = keccak256(abi.encode("execution-core", launchId));
            permit.executionCalldataKeccak256 = keccak256(abi.encode("downstream-calldata", launchId));
            permit.executionValue = 0;
            permit.releaseBindingHash = authority.computeReleaseBindingHash(fixture.releaseBinding);
            permit.kernelExecutionEnvelopeHash = authority.computeKernelExecutionEnvelopeHash(kernelEnvelope);
            permit.generationBindingHash = authority.computeGenerationBindingHash(permit);
            signature = _sign(SIGNER_KEY, authority.hashPermit(permit));
        }

        function _registration(
            ReleaseFixture memory fixture,
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit
        ) private view returns (IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 memory registration) {
            registration.schemaVersion = 1;
            registration.chainId = block.chainid;
            registration.registryGeneration = fixture.registry.REGISTRY_GENERATION();
            registration.approvalGeneration = permit.approvalGeneration;
            registration.permitGeneration = permit.permitGeneration;
            registration.permitNonce = permit.nonce;
            registration.permitDigest = authority.hashPermit(permit);
            registration.routeId = permit.routeId;
            registration.profileId = fixture.route.PROFILE_ID();
            registration.technicalApproval = IProgrammableHookemonLaunchRegistryV1.TechnicalApprovalV1({
                githubRepositoryId: permit.githubRepositoryId,
                repositoryKey: permit.repositoryKey,
                approvalId: permit.approvalId,
                technicalApprovalHash: permit.technicalApprovalHash,
                approvedRepositoryHeadHash: keccak256("approved-repository-head"),
                executableArtifactSourceHash: keccak256("executable-artifact-source"),
                exactContractBindingHash: keccak256("exact-contract-binding")
            });
            registration.launchIdentity = IProgrammableHookemonLaunchRegistryV1.JitLaunchIdentityV1({
                launchId: permit.launchId,
                applicantWallet: permit.applicantWallet,
                descriptorHash: permit.descriptorHash,
                tokenNameHash: keccak256("Hookemon"),
                tokenSymbolHash: keccak256("HKMN"),
                presentationBindingHash: permit.presentationBindingHash,
                configurationHash: permit.configurationHash,
                executionPlanHash: permit.executionPlanHash,
                executionCoreHash: permit.executionCoreHash,
                executionCalldataKeccak256: permit.executionCalldataKeccak256,
                releaseBindingHash: permit.releaseBindingHash
            });
            registration.graph = IProgrammableHookemonLaunchRegistryV1.HookemonGraphV1({
                executor: address(components[0]),
                executorRuntimeCodeHash: address(components[0]).codehash,
                launcher: address(components[1]),
                launcherRuntimeCodeHash: address(components[1]).codehash,
                token: address(components[2]),
                tokenRuntimeCodeHash: address(components[2]).codehash,
                hook: address(components[3]),
                hookRuntimeCodeHash: address(components[3]).codehash,
                poolManager: address(components[4]),
                poolManagerRuntimeCodeHash: address(components[4]).codehash,
                canonicalPoolId: keccak256("canonical-pool-id"),
                componentGraphHash: keccak256(abi.encode("component-graph", permit.launchId)),
                componentRuntimeSetHash: keccak256("component-runtime-set"),
                architectureStateHash: keccak256("architecture-state"),
                poolStateHash: keccak256("pool-state"),
                revenueStateHash: keccak256("revenue-state"),
                revenueBindingHash: REVENUE_BINDING_HASH
            });
            registration.registeredRecordCommitment = fixture.registry.computeRegisteredRecordCommitmentV1(registration);
        }

        function _sign(uint256 privateKey, bytes32 digest) private pure returns (bytes memory) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
            return abi.encodePacked(r, s, v);
        }
    }
