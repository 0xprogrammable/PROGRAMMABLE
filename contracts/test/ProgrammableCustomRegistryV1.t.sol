// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";

import {
    ProgrammableCustomFeePolicyVerifierLibV1,
    ProgrammableCustomFeePolicyVerifierV1
} from "../src/ProgrammableCustomFeePolicyVerifierV1.sol";
import { ProgrammableCustomAtomicRegistrarV1 } from "../src/ProgrammableCustomAtomicRegistrarV1.sol";
import { ProgrammableCustomPartnerFactoryRegistryV1 } from "../src/ProgrammableCustomPartnerFactoryRegistryV1.sol";
import { ProgrammableCustomRegistryGenesisCanaryV1 } from "../src/ProgrammableCustomRegistryGenesisCanaryV1.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "../src/interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";

contract RegistryRuntimeTargetV1 {
    function version() external pure returns (uint256) {
        return 1;
    }
}

contract PartnerFactoryHarnessV1 {
    function predict(bytes32 salt) external view returns (address) {
        bytes32 digest = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(type(RegistryRuntimeTargetV1).creationCode))
        );
        return address(uint160(uint256(digest)));
    }

    function register(
        IProgrammableCustomRegistryV1 registry,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration
    ) external {
        registry.registerLaunch(registration);
    }

    function deployAndRegister(
        IProgrammableCustomRegistryV1 registry,
        bytes32 salt,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration
    ) external returns (address deployed) {
        deployed = address(new RegistryRuntimeTargetV1{ salt: salt }());
        require(deployed == registration.primaryContract, "unexpected deployment");
        registry.registerLaunch(registration);
    }
}

contract AtomicLaunchTargetV1 {
    uint256 public configuredValue;

    function initialize(uint256 value) external returns (bytes32 result) {
        require(configuredValue == 0, "already initialized");
        require(value != 999, "rejected initialization");
        configuredValue = value;
        result = keccak256(abi.encode(value));
    }
}

contract AtomicReentrantLaunchTargetV1 {
    function initialize(address registrar, bytes calldata reentrantCall) external returns (bytes32) {
        (bool success, bytes memory returnData) = registrar.call(reentrantCall);
        if (success) revert("unexpected reentrant success");
        assembly ("memory-safe") {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}

contract ProgrammableCustomRegistryV1Test is Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant APPROVER = address(0xA990);
    address internal constant WRITER = address(0xB001);
    address internal constant FINALIZER = address(0xF1A1);
    address internal constant CORRECTOR = address(0xC011);
    address internal constant REVOKER = address(0xDEAD);
    address internal constant OUTSIDER = address(0xBAD);
    address internal constant PROGRAMMABLE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant PARTNER_RECIPIENT = address(0xB453);
    address internal constant FEE_CURRENCY = address(0xC0FFEE);

    uint64 internal constant GENERATION = 1;
    uint64 internal constant FINALITY_BLOCKS = 3;

    ProgrammableCustomRegistryV1 internal registry;
    ProgrammableCustomAtomicRegistrarV1 internal atomicRegistrar;
    ProgrammableCustomFeePolicyVerifierV1 internal feeVerifier;
    ProgrammableCustomPartnerFactoryRegistryV1 internal partnerFactoryRegistry;
    RegistryRuntimeTargetV1 internal runtimeTarget;
    PartnerFactoryHarnessV1 internal partnerFactory;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        vm.warp(1_800_000_000);
        runtimeTarget = new RegistryRuntimeTargetV1();
        partnerFactory = new PartnerFactoryHarnessV1();
        feeVerifier = new ProgrammableCustomFeePolicyVerifierV1();
        partnerFactoryRegistry =
            new ProgrammableCustomPartnerFactoryRegistryV1(2 days, ADMIN, APPROVER, REVOKER, GENERATION);
        registry = new ProgrammableCustomRegistryV1(
            _registryConfig(FINALITY_BLOCKS, _hash("ethereum-mainnet-chain-profile")),
            partnerFactoryRegistry,
            feeVerifier
        );
        atomicRegistrar = new ProgrammableCustomAtomicRegistrarV1(registry);
        bytes32 writerRole = registry.WRITER_ROLE();
        vm.prank(ADMIN);
        registry.grantRole(writerRole, address(atomicRegistrar));
    }

    function test_constructorBindsScopeLabelsRecipientAndLeastPrivilegeRoles() public view {
        assertEq(registry.CHAIN_ID(), 1);
        assertEq(registry.REGISTRY_GENERATION(), GENERATION);
        assertEq(registry.MINIMUM_FINALITY_BLOCKS(), FINALITY_BLOCKS);
        assertEq(registry.PLATFORM_ID(), "programmable");
        assertEq(registry.CATEGORY(), "custom");
        assertEq(registry.PUBLIC_CATEGORY(), "Programmable Custom");
        assertEq(registry.PROGRAMMABLE_FEE_RECIPIENT(), PROGRAMMABLE_RECIPIENT);
        assertEq(feeVerifier.PROGRAMMABLE_FEE_RECIPIENT(), PROGRAMMABLE_RECIPIENT);
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertTrue(registry.hasRole(registry.APPROVER_ROLE(), APPROVER));
        assertTrue(registry.hasRole(registry.WRITER_ROLE(), WRITER));
        assertTrue(registry.hasRole(registry.FINALIZER_ROLE(), FINALIZER));
        assertTrue(registry.hasRole(registry.CORRECTOR_ROLE(), CORRECTOR));
        assertTrue(registry.hasRole(registry.REVOKER_ROLE(), REVOKER));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), WRITER));
    }

    function test_constructorRejectsFinalityDepthOutsideNativeBlockhashWindow() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRegistryV1.RegistryConfigurationInvalid.selector, bytes32("finality-blocks")
            )
        );
        new ProgrammableCustomRegistryV1(_registryConfig(256, _hash("chain")), partnerFactoryRegistry, feeVerifier);
    }

    function test_registersNativeCustomWithExactTenBpsAndOpenWorldCommitments() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _nativeRegistration("native");
        bytes32 expectedFeePolicyHash = feeVerifier.verify(registration.feePolicy);

        _register(registration);

        IProgrammableCustomRegistryV1.LaunchStateV1 memory state = registry.launchState(registration.launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed));
        assertEq(state.observedAtBlock, 100);
        assertEq(state.latestRecordRevision, 1);
        assertEq(state.latestRecordHash, registration.registeredRecordCommitment);
        assertEq(state.feePolicyHash, expectedFeePolicyHash);
        assertEq(registry.recordHashAtRevision(registration.launchId, 1), registration.registeredRecordCommitment);
        assertTrue(registry.approvalConsumed(registration.approvalId));
        assertTrue(registry.deploymentConsumed(registration.deploymentId));
        assertEq(registry.registrationCount(), 1);
        assertEq(registry.approvalAuthorizationCount(), 1);
        assertEq(registry.transitionCount(), 2);
        assertTrue(registry.approvalState(registration.approvalId).consumed);

        IProgrammableCustomRegistryV1.LaunchDetailsV1 memory details = registry.launchDetails(registration.launchId);
        assertEq(details.providerId, bytes32(0));
        assertEq(details.templateId, registration.templateId);
        assertEq(details.primaryRuntimeCodeHash, address(runtimeTarget).codehash);
    }

    function test_registersPartnerTemplateAtExactTwentyBpsWithoutNativeSurcharge() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("basebit-synthetic-fixture");

        _register(registration);

        IProgrammableCustomRegistryV1.LaunchDetailsV1 memory details = registry.launchDetails(registration.launchId);
        assertEq(details.providerId, registration.feePolicy.providerId);
        assertEq(details.templateId, registration.feePolicy.templateId);
        assertEq(registration.feePolicy.totalFeeBps, 20);
        assertEq(registration.feePolicy.partner.shareBps, 15);
        assertEq(registration.feePolicy.programmable.shareBps, 5);
        assertEq(registration.feePolicy.nativeCustomFeeBps, 0);
    }

    function test_partnerPolicyIsScopedToCanonicalAeonProvider() public {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _partnerFeePolicy();
        assertEq(policy.providerId, keccak256("aeon"));
        policy.providerId = _hash("unknown-provider");
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);
    }

    function test_aeonFactoryDeploysAndRegistersInTheSameTransaction() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _partnerRegistration("aeon-atomic");
        bytes32 salt = _hash("aeon-atomic-salt");
        registration.primaryContract = partnerFactory.predict(salt);
        registration.primaryRuntimeCodeHash = keccak256(type(RegistryRuntimeTargetV1).runtimeCode);
        registration.deploymentConfigurationHash = keccak256(
            abi.encode(address(partnerFactory), salt, registration.primaryContract, registration.primaryRuntimeCodeHash)
        );
        _authorizePartnerFactory(registration);
        _rebind(registration);
        _authorize(registration);

        address deployed = partnerFactory.deployAndRegister(registry, salt, registration);

        assertEq(deployed, registration.primaryContract);
        assertEq(deployed.codehash, registration.primaryRuntimeCodeHash);
        assertEq(uint8(registry.launchState(registration.launchId).status), 1);
        assertEq(registry.launchDetails(registration.launchId).configurationHash, registration.configurationHash);
    }

    function test_aeonFactoryDeploymentRollsBackWhenAtomicRegistrationFails() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("aeon-atomic-rollback");
        bytes32 salt = _hash("aeon-atomic-rollback-salt");
        registration.primaryContract = partnerFactory.predict(salt);
        registration.primaryRuntimeCodeHash = keccak256(type(RegistryRuntimeTargetV1).runtimeCode);
        _authorizePartnerFactory(registration);
        _rebind(registration);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV1.ApprovalNotAuthorized.selector, registration.approvalId)
        );
        partnerFactory.deployAndRegister(registry, salt, registration);

        assertEq(registration.primaryContract.code.length, 0);
    }

    function test_partnerRegistrationRejectsGlobalWriterWrongFactoryMutationAndRevokedFactory() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("aeon-exact-factory");
        _authorizePartnerFactory(registration);
        _rebind(registration);
        _authorize(registration);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomPartnerFactoryRegistryV1.FactoryCallerMismatch.selector,
                WRITER,
                address(partnerFactory)
            )
        );
        vm.prank(WRITER);
        registry.registerLaunch(registration);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory mutated = registration;
        mutated.permissionsHash = _hash("mutated-permissions");
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV1.ConfigurationMismatch.selector);
        partnerFactory.register(registry, mutated);

        vm.prank(REVOKER);
        partnerFactoryRegistry.revokeFactory(
            registration.configurationHash, _hash("factory-retired"), _hash("factory-retired-evidence")
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomPartnerFactoryRegistryV1.ConfigurationNotActive.selector,
                registration.configurationHash
            )
        );
        partnerFactory.register(registry, registration);
    }

    function test_partnerFactoryAuthorizationRejectsArbitraryConfigurationAndRuntimeHash() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("aeon-bad-factory-approval");
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization =
            _partnerFactoryAuthorization(registration);
        authorization.configurationHash = _hash("arbitrary-configuration");
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV1.ConfigurationMismatch.selector);
        vm.prank(APPROVER);
        partnerFactoryRegistry.authorizeFactory(authorization);

        authorization = _partnerFactoryAuthorization(registration);
        authorization.factoryRuntimeCodeHash = _hash("wrong-runtime");
        authorization.configurationHash = partnerFactoryRegistry.computeConfigurationHash(authorization);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV1.FactoryRuntimeMismatch.selector);
        vm.prank(APPROVER);
        partnerFactoryRegistry.authorizeFactory(authorization);
    }

    function test_partnerConfigurationHashBindsExactModelAndFactorySourceCommits() public view {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("aeon-source-bound-configuration");
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization =
            _partnerFactoryAuthorization(registration);
        bytes32 canonical = partnerFactoryRegistry.computeConfigurationHash(authorization);

        authorization.modelSourceCommitId = _hash("different-model-source-commit");
        assertTrue(partnerFactoryRegistry.computeConfigurationHash(authorization) != canonical);

        authorization = _partnerFactoryAuthorization(registration);
        authorization.factorySourceCommitId = _hash("different-factory-source-commit");
        assertTrue(partnerFactoryRegistry.computeConfigurationHash(authorization) != canonical);
    }

    function test_partnerConfigurationHashGoldenVector() public view {
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization =
            IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1({
                chainId: 1,
                registryGeneration: GENERATION,
                configurationHash: bytes32(0),
                providerId: keccak256("aeon"),
                modelId: keccak256("aeon.example-model"),
                modelVersion: keccak256("1.0.0"),
                templateId: keccak256("aeon.example-template"),
                templateVersion: keccak256("1.0.0"),
                modelRepositoryId: keccak256("https://github.com/0xprogrammable/aeon-launch-models"),
                modelSourceCommitId: keccak256("git-sha1:1111111111111111111111111111111111111111"),
                factorySourceRepositoryId: keccak256("https://github.com/aeon/example-factory"),
                factorySourceCommitId: keccak256("git-sha1:2222222222222222222222222222222222222222"),
                factory: 0x3333333333333333333333333333333333333333,
                factoryRuntimeCodeHash: 0x4444444444444444444444444444444444444444444444444444444444444444,
                launchRuntimeCodeSetHash: 0x5555555555555555555555555555555555555555555555555555555555555555,
                permissionsHash: 0x6666666666666666666666666666666666666666666666666666666666666666,
                feePolicyHash: 0x7777777777777777777777777777777777777777777777777777777777777777,
                validAfterBlock: 1,
                expiresAtBlock: 2,
                evidenceHash: bytes32(uint256(1))
            });

        assertEq(
            partnerFactoryRegistry.computeConfigurationHash(authorization),
            0xd0f7b1d29ce6a59052ca9d3b773183a3a3cc40e408fc7cf3ca3beeb20535359b
        );
    }

    function test_newChainUsesDistinctRegistryScopeWhileAcceptingCanonicalPublicLaunchId() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory mainnetRegistration =
            _nativeRegistration("multi-chain");

        vm.chainId(8453);
        ProgrammableCustomPartnerFactoryRegistryV1 basePartnerFactoryRegistry =
            new ProgrammableCustomPartnerFactoryRegistryV1(2 days, ADMIN, APPROVER, REVOKER, GENERATION);
        ProgrammableCustomRegistryV1 baseRegistry = new ProgrammableCustomRegistryV1(
            _registryConfig(FINALITY_BLOCKS, _hash("base-chain-profile")), basePartnerFactoryRegistry, feeVerifier
        );
        assertEq(baseRegistry.CHAIN_ID(), 8453);
        assertEq(mainnetRegistration.chainId, 1);
        assertTrue(mainnetRegistration.launchId != bytes32(0));
    }

    function test_registrationSupportsProjectOnlyAndNullMarketWithoutInventingTokenOrPool() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _nativeRegistration("project-only");
        registration.assetSetHash = keccak256(abi.encode(new address[](0)));
        registration.marketSetHash = keccak256(abi.encode(new bytes32[](0)));
        registration.marketPathId = bytes32(0);
        registration.feePolicy = _noQualifyingMarketFeePolicy();
        _rebind(registration);

        _register(registration);

        assertEq(uint8(registry.launchState(registration.launchId).status), 1);
        assertEq(uint8(registration.feePolicy.kind), 2);
        assertEq(registration.feePolicy.totalFeeBps, 0);
        assertTrue(registration.assetSetHash != bytes32(0));
        assertTrue(registration.marketSetHash != bytes32(0));
    }

    function test_genesisCanaryDeploysAndRegistersAtomicallyWithoutMarketOrInitializer() public {
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request;
        request.salt = _hash("registry-genesis-canary-v1-salt");
        request.creationCode = type(ProgrammableCustomRegistryGenesisCanaryV1).creationCode;
        request.initializationResultHash = keccak256("");
        request.registration = _nativeRegistration("registry-genesis-canary-v1");
        request.registration.modelId = bytes32(0);
        request.registration.modelVersion = bytes32(0);
        request.registration.templateId = bytes32(0);
        request.registration.templateVersion = bytes32(0);
        request.registration.marketPathId = bytes32(0);
        request.registration.assetSetHash = keccak256(abi.encode(new address[](0)));
        request.registration.marketSetHash = keccak256(abi.encode(new bytes32[](0)));
        request.registration.feePolicy = _noQualifyingMarketFeePolicy();
        request.registration.primaryContract =
            atomicRegistrar.predictAddress(request.salt, keccak256(request.creationCode));
        request.registration.primaryRuntimeCodeHash =
            keccak256(type(ProgrammableCustomRegistryGenesisCanaryV1).runtimeCode);
        request.registration.launchWallet = address(this);
        request.registration.deploymentConfigurationHash = atomicRegistrar.computeAtomicRequestCommitment(request);
        _rebind(request.registration);
        _authorize(request.registration);

        address deployed = atomicRegistrar.deployInitializeAndRegister(request);

        assertEq(deployed, request.registration.primaryContract);
        assertEq(deployed.codehash, request.registration.primaryRuntimeCodeHash);
        assertEq(uint8(registry.launchState(request.registration.launchId).status), 1);
        assertTrue(ProgrammableCustomRegistryGenesisCanaryV1(deployed).PROJECT_ONLY());
        assertEq(ProgrammableCustomRegistryGenesisCanaryV1(deployed).CHAIN_ID(), 1);
        assertEq(ProgrammableCustomRegistryGenesisCanaryV1(deployed).REGISTRY_GENERATION(), GENERATION);
    }

    function test_partnerAttributionCanRemainWhenProjectOnlyHasNoQualifyingFeeMarket() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("partner-project-only");
        bytes32 providerId = registration.providerId;
        bytes32 templateId = registration.templateId;
        registration.assetSetHash = keccak256(abi.encode(new address[](0)));
        registration.marketSetHash = keccak256(abi.encode(new bytes32[](0)));
        registration.marketPathId = bytes32(0);
        registration.feePolicy = _noQualifyingMarketFeePolicy();
        _rebind(registration);

        _register(registration);

        IProgrammableCustomRegistryV1.LaunchDetailsV1 memory details = registry.launchDetails(registration.launchId);
        assertEq(details.providerId, providerId);
        assertEq(details.templateId, templateId);
        assertEq(registration.feePolicy.totalFeeBps, 0);
        assertEq(registration.feePolicy.partner.shareBps, 0);
        assertEq(registration.feePolicy.programmable.shareBps, 0);
    }

    function test_invalidFeePolicyRollsBackEveryRegistrationWrite() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _nativeRegistration("rollback");
        _authorize(registration);
        registration.feePolicy.programmable.shareBps = 11;

        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        vm.prank(WRITER);
        registry.registerLaunch(registration);

        assertFalse(registry.approvalConsumed(registration.approvalId));
        assertFalse(registry.deploymentConsumed(registration.deploymentId));
        assertEq(uint8(registry.launchState(registration.launchId).status), 0);
        assertEq(registry.registrationCount(), 0);
        assertEq(registry.transitionCount(), 1);
    }

    function test_onlyWriterCanRegister() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _nativeRegistration("unauthorized");
        _authorize(registration);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, OUTSIDER, registry.WRITER_ROLE()
            )
        );
        vm.prank(OUTSIDER);
        registry.registerLaunch(registration);
    }

    function test_registrationRequiresIndependentApprovalAuthority() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _nativeRegistration("missing-approval");
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV1.ApprovalNotAuthorized.selector, registration.approvalId)
        );
        vm.prank(WRITER);
        registry.registerLaunch(registration);

        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory authorization = _authorization(registration);
        bytes32 approverRole = registry.APPROVER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, WRITER, approverRole)
        );
        vm.prank(WRITER);
        registry.authorizeApproval(authorization);
    }

    function test_approvalAuthorizationIsAppendOnlyWindowedAndSeparatesWriterRole() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _nativeRegistration("windowed");
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory authorization = _authorization(registration);
        authorization.validAfterBlock = 101;
        authorization.expiresAtBlock = 102;
        vm.prank(APPROVER);
        registry.authorizeApproval(authorization);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV1.ApprovalNotYetValid.selector, uint64(101), uint256(100))
        );
        vm.prank(WRITER);
        registry.registerLaunch(registration);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRegistryV1.ApprovalAlreadyAuthorized.selector, registration.approvalId
            )
        );
        vm.prank(APPROVER);
        registry.authorizeApproval(authorization);

        vm.roll(103);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV1.ApprovalExpired.selector, uint64(102), uint256(103))
        );
        vm.prank(WRITER);
        registry.registerLaunch(registration);

        bytes32 approverRole = registry.APPROVER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV1.IncompatibleOperationalRoles.selector, WRITER)
        );
        vm.prank(ADMIN);
        registry.grantRole(approverRole, WRITER);
    }

    function test_acceptsCurrentPublicIdentitySha256JcsLaunchIdGoldenVector() public {
        // sha256("programmable.custom-launch-id.v2" || 0x00 || RFC8785-JCS(value)); see registry docs.
        bytes32 canonicalLaunchId = 0xa5fd9db098fd84f2d8195dfb55f626234bf69471e68d4883e6e433d23de0db86;
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _nativeRegistration("projection-v2-golden-vector");
        registration.launchId = canonicalLaunchId;
        _rebind(registration);

        _register(registration);

        assertEq(uint8(registry.launchState(canonicalLaunchId).status), 1);
        assertEq(registry.launchDetails(canonicalLaunchId).approvalId, registration.approvalId);
    }

    function test_registeredRecordAndIdentityCommitmentGoldenVector() public pure {
        bytes32 registeredRecordCommitment = keccak256(
            abi.encode(
                keccak256("programmable.custom-registered-record.v1"),
                0x1111111111111111111111111111111111111111111111111111111111111111,
                0x2222222222222222222222222222222222222222222222222222222222222222,
                0x3333333333333333333333333333333333333333333333333333333333333333,
                0x4444444444444444444444444444444444444444444444444444444444444444,
                0x5555555555555555555555555555555555555555555555555555555555555555,
                0x6666666666666666666666666666666666666666666666666666666666666666
            )
        );
        assertEq(registeredRecordCommitment, 0xb3d24d3567fbeb2096654435c358ef31de250a2753fd7c5dbd7eb3bbc3bd67a0);
        assertEq(
            keccak256(abi.encode(keccak256("programmable.custom-launch-identity.v1"), registeredRecordCommitment)),
            0x8f1132fb9f4edb9150c045a6a04ed5a9bf00a7d19b730f118a20ab4243260d1d
        );
    }

    function test_atomicRegistrarDeploysInitializesAndRegistersOrAllRevert() public {
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request = _atomicRequest("atomic", 42);
        _authorize(request.registration);

        address deployed = atomicRegistrar.deployInitializeAndRegister(request);

        assertEq(deployed, request.registration.primaryContract);
        assertEq(AtomicLaunchTargetV1(deployed).configuredValue(), 42);
        assertEq(uint8(registry.launchState(request.registration.launchId).status), 1);
        assertTrue(registry.approvalState(request.registration.approvalId).consumed);
    }

    function test_atomicRegistrarRollsBackDeploymentAndInitializationWhenRegistryRejects() public {
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request =
            _atomicRequest("atomic-registry-revert", 42);
        _authorize(request.registration);
        request.registration.registeredRecordCommitment = bytes32(0);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRegistryV1.InvalidBinding.selector, bytes32("registered-record-commitment")
            )
        );
        atomicRegistrar.deployInitializeAndRegister(request);

        assertEq(request.registration.primaryContract.code.length, 0);
        assertFalse(registry.approvalState(request.registration.approvalId).consumed);
        assertFalse(registry.deploymentConsumed(request.registration.deploymentId));
    }

    function test_atomicRegistrarRollsBackDeploymentWhenInitializationFails() public {
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request =
            _atomicRequest("atomic-initialization-revert", 999);
        _authorize(request.registration);

        vm.expectPartialRevert(ProgrammableCustomAtomicRegistrarV1.InitializationFailed.selector);
        atomicRegistrar.deployInitializeAndRegister(request);

        assertEq(request.registration.primaryContract.code.length, 0);
        assertFalse(registry.approvalState(request.registration.approvalId).consumed);
    }

    function test_atomicRegistrarRejectsInitializationDifferentFromApprovedConfiguration() public {
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request =
            _atomicRequest("atomic-config-mutation", 42);
        _authorize(request.registration);
        request.initializationCall = abi.encodeCall(AtomicLaunchTargetV1.initialize, (43));

        vm.expectPartialRevert(ProgrammableCustomAtomicRegistrarV1.AtomicRequestBindingMismatch.selector);
        atomicRegistrar.deployInitializeAndRegister(request);

        assertEq(request.registration.primaryContract.code.length, 0);
        assertFalse(registry.approvalState(request.registration.approvalId).consumed);
    }

    function test_atomicRegistrarReentrantInitializerRevertsAndRollsBackEverything() public {
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory nestedRequest;
        bytes memory reentrantCall =
            abi.encodeCall(ProgrammableCustomAtomicRegistrarV1.deployInitializeAndRegister, (nestedRequest));

        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request;
        request.salt = _hash("atomic-reentrant-salt");
        request.creationCode = type(AtomicReentrantLaunchTargetV1).creationCode;
        request.initializationCall =
            abi.encodeCall(AtomicReentrantLaunchTargetV1.initialize, (address(atomicRegistrar), reentrantCall));
        request.initializationResultHash = keccak256(abi.encode(bytes32(0)));
        request.registration = _nativeRegistration("atomic-reentrant");
        request.registration.primaryContract =
            atomicRegistrar.predictAddress(request.salt, keccak256(request.creationCode));
        request.registration.primaryRuntimeCodeHash = keccak256(type(AtomicReentrantLaunchTargetV1).runtimeCode);
        request.registration.launchWallet = address(this);
        request.registration.deploymentConfigurationHash = atomicRegistrar.computeAtomicRequestCommitment(request);
        _rebind(request.registration);
        _authorize(request.registration);

        bytes memory reentrancyError = abi.encodeWithSelector(bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomAtomicRegistrarV1.InitializationFailed.selector, keccak256(reentrancyError)
            )
        );
        atomicRegistrar.deployInitializeAndRegister(request);

        assertEq(request.registration.primaryContract.code.length, 0);
        assertEq(uint8(registry.launchState(request.registration.launchId).status), 0);
        assertFalse(registry.approvalState(request.registration.approvalId).consumed);
        assertFalse(registry.deploymentConsumed(request.registration.deploymentId));
    }

    function test_rejectsWrongChainAndGenerationBeforeConsumption() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory wrongChain = _nativeRegistration("wrong-chain");
        wrongChain.chainId = 8453;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRegistryV1.RegistryScopeMismatch.selector, uint256(8453), GENERATION
            )
        );
        vm.prank(WRITER);
        registry.registerLaunch(wrongChain);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory wrongGeneration =
            _nativeRegistration("wrong-generation");
        wrongGeneration.registryGeneration = 2;
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV1.RegistryScopeMismatch.selector, uint256(1), uint64(2))
        );
        vm.prank(WRITER);
        registry.registerLaunch(wrongGeneration);
    }

    function test_rejectsFakeLaunchIdRuntimeAndApprovalMutation() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory fakeId = _nativeRegistration("fake-id");
        _authorize(fakeId);
        fakeId.launchId = _hash("attacker-id");
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.ApprovalLaunchIdMismatch.selector);
        vm.prank(WRITER);
        registry.registerLaunch(fakeId);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory runtime = _nativeRegistration("runtime");
        runtime.primaryRuntimeCodeHash = _hash("fake-runtime");
        _rebind(runtime);
        _authorize(runtime);
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.RuntimeCodeHashMismatch.selector);
        vm.prank(WRITER);
        registry.registerLaunch(runtime);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory mutated = _nativeRegistration("mutated-commit");
        _authorize(mutated);
        mutated.commitId = _hash("different-commit");
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.ApprovalBindingMismatch.selector);
        vm.prank(WRITER);
        registry.registerLaunch(mutated);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory mutatedRecord = _nativeRegistration("mutated-record");
        _authorize(mutatedRecord);
        mutatedRecord.registeredRecordCommitment = _hash("writer-substituted-record");
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.RegisteredRecordCommitmentMismatch.selector);
        vm.prank(WRITER);
        registry.registerLaunch(mutatedRecord);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory selfConsistentMutation =
            _nativeRegistration("self-consistent-writer-mutation");
        _authorize(selfConsistentMutation);
        selfConsistentMutation.securityReviewHash = _hash("writer-substituted-review");
        bytes32 selfConsistentFeePolicyHash = registry.computeFeePolicyHash(selfConsistentMutation.feePolicy);
        selfConsistentMutation.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(selfConsistentMutation, selfConsistentFeePolicyHash);
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.RegistrationBindingMismatch.selector);
        vm.prank(WRITER);
        registry.registerLaunch(selfConsistentMutation);
    }

    function test_rejectsApprovalAndDeploymentReplay() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory first = _nativeRegistration("first");
        _register(first);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory approvalReplay =
            _nativeRegistration("approval-replay");
        approvalReplay.approvalId = first.approvalId;
        _rebind(approvalReplay);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV1.ApprovalAlreadyConsumed.selector, first.approvalId)
        );
        vm.prank(WRITER);
        registry.registerLaunch(approvalReplay);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory deploymentReplay =
            _nativeRegistration("deployment-replay");
        deploymentReplay.deploymentId = first.deploymentId;
        _rebind(deploymentReplay);
        _authorize(deploymentReplay);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV1.DeploymentAlreadyConsumed.selector, first.deploymentId)
        );
        vm.prank(WRITER);
        registry.registerLaunch(deploymentReplay);
    }

    function test_finalizesOnlyAfterNativeBlockhashAndDepthProof() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _nativeRegistration("finality");
        _register(registration);

        vm.roll(104);
        bytes32 observedHash = _hash("block-100");
        bytes32 confirmedHeadHash = _hash("block-103");
        vm.setBlockhash(100, observedHash);
        vm.setBlockhash(103, confirmedHeadHash);
        IProgrammableCustomRegistryV1.FinalityProofV1 memory proof =
            _finalityProof(registration, observedHash, confirmedHeadHash, _hash("finality-evidence"));

        vm.prank(FINALIZER);
        registry.finalizeLaunch(proof);

        IProgrammableCustomRegistryV1.LaunchStateV1 memory state = registry.launchState(registration.launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV1.LaunchStatus.Finalized));
        assertEq(state.finalizedAtBlock, 104);
        assertEq(state.finalityEvidenceHash, proof.finalityEvidenceHash);
        assertTrue(registry.transitionEvidenceConsumed(proof.finalityEvidenceHash));
    }

    function test_rejectsShallowWrongHashAndOlderThanBlockhashWindow() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory shallowRegistration = _nativeRegistration("shallow");
        _register(shallowRegistration);
        vm.roll(102);
        vm.setBlockhash(100, _hash("block-100"));
        vm.setBlockhash(101, _hash("block-101"));
        IProgrammableCustomRegistryV1.FinalityProofV1 memory shallow =
            _finalityProof(shallowRegistration, _hash("block-100"), _hash("block-101"), _hash("shallow-evidence"));
        shallow.confirmedHeadBlockNumber = 101;
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.FinalityDepthInsufficient.selector);
        vm.prank(FINALIZER);
        registry.finalizeLaunch(shallow);

        vm.roll(104);
        vm.setBlockhash(100, _hash("canonical-100"));
        vm.setBlockhash(103, _hash("block-103"));
        IProgrammableCustomRegistryV1.FinalityProofV1 memory wrongHash =
            _finalityProof(shallowRegistration, _hash("fake-100"), _hash("block-103"), _hash("wrong-hash-evidence"));
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.BlockHashMismatch.selector);
        vm.prank(FINALIZER);
        registry.finalizeLaunch(wrongHash);

        vm.roll(357);
        IProgrammableCustomRegistryV1.FinalityProofV1 memory expired =
            _finalityProof(shallowRegistration, _hash("old-100"), _hash("head-356"), _hash("expired-evidence"));
        expired.confirmedHeadBlockNumber = 356;
        vm.setBlockhash(356, expired.confirmedHeadBlockHash);
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.HistoricalBlockOutsideNativeWindow.selector);
        vm.prank(FINALIZER);
        registry.finalizeLaunch(expired);
    }

    function test_correctionIsAppendOnlyAndLogCarriesCorrectedHash() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _registerAndFinalize("correction");
        IProgrammableCustomRegistryV1.RecordCorrectionV1 memory correction =
            IProgrammableCustomRegistryV1.RecordCorrectionV1({
                chainId: 1,
                registryGeneration: GENERATION,
                launchId: registration.launchId,
                revision: 2,
                previousRecordHash: registration.registeredRecordCommitment,
                correctedRecordHash: _hash("corrected-record"),
                reasonCode: _hash("metadata-correction"),
                evidenceHash: _hash("correction-evidence")
            });

        vm.recordLogs();
        vm.prank(CORRECTOR);
        registry.correctLaunchRecord(correction);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[1], registration.launchId);
        assertEq(uint256(logs[0].topics[2]), 2);
        assertEq(logs[0].topics[3], correction.correctedRecordHash);
        assertEq(registry.recordHashAtRevision(registration.launchId, 1), registration.registeredRecordCommitment);
        assertEq(registry.recordHashAtRevision(registration.launchId, 2), correction.correctedRecordHash);
        assertEq(registry.launchState(registration.launchId).latestRecordHash, correction.correctedRecordHash);
    }

    function test_rejectsSkippedCorrectionReusedEvidenceAndMutationAfterRevocation() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _registerAndFinalize("terminal");
        IProgrammableCustomRegistryV1.RecordCorrectionV1 memory skipped =
            IProgrammableCustomRegistryV1.RecordCorrectionV1({
                chainId: 1,
                registryGeneration: GENERATION,
                launchId: registration.launchId,
                revision: 3,
                previousRecordHash: registration.registeredRecordCommitment,
                correctedRecordHash: _hash("revision-three"),
                reasonCode: _hash("correction"),
                evidenceHash: _hash("shared-evidence")
            });
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.RecordRevisionMismatch.selector);
        vm.prank(CORRECTOR);
        registry.correctLaunchRecord(skipped);

        IProgrammableCustomRegistryV1.LaunchRevocationV1 memory revocation =
            IProgrammableCustomRegistryV1.LaunchRevocationV1({
                chainId: 1,
                registryGeneration: GENERATION,
                launchId: registration.launchId,
                reasonCode: _hash("runtime-authority-changed"),
                evidenceHash: _hash("revocation-evidence")
            });
        vm.prank(REVOKER);
        registry.revokeLaunch(revocation);
        assertEq(uint8(registry.launchState(registration.launchId).status), 3);

        skipped.revision = 2;
        skipped.evidenceHash = _hash("post-revocation");
        vm.expectPartialRevert(ProgrammableCustomRegistryV1.InvalidLaunchState.selector);
        vm.prank(CORRECTOR);
        registry.correctLaunchRecord(skipped);

        vm.expectPartialRevert(ProgrammableCustomRegistryV1.InvalidLaunchState.selector);
        vm.prank(REVOKER);
        registry.revokeLaunch(revocation);
    }

    function test_rejectsTransitionEvidenceReplayAcrossLaunches() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory first = _registerAndFinalize("evidence-first");
        IProgrammableCustomRegistryV1.RecordCorrectionV1 memory correction =
            IProgrammableCustomRegistryV1.RecordCorrectionV1({
                chainId: 1,
                registryGeneration: GENERATION,
                launchId: first.launchId,
                revision: 2,
                previousRecordHash: first.registeredRecordCommitment,
                correctedRecordHash: _hash("first-corrected"),
                reasonCode: _hash("correction"),
                evidenceHash: _hash("globally-unique-transition-evidence")
            });
        vm.prank(CORRECTOR);
        registry.correctLaunchRecord(correction);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory second = _nativeRegistration("evidence-second");
        vm.roll(110);
        _register(second);
        IProgrammableCustomRegistryV1.LaunchRevocationV1 memory replay = IProgrammableCustomRegistryV1.LaunchRevocationV1({
            chainId: 1,
            registryGeneration: GENERATION,
            launchId: second.launchId,
            reasonCode: _hash("incident"),
            evidenceHash: correction.evidenceHash
        });
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRegistryV1.EvidenceAlreadyConsumed.selector, correction.evidenceHash
            )
        );
        vm.prank(REVOKER);
        registry.revokeLaunch(replay);
    }

    function test_nativeFeePolicyRejectsWrongRateRecipientAndPartnerFields() public {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _nativeFeePolicy();
        policy.programmable.shareBps = 11;
        policy.totalFeeBps = 11;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _nativeFeePolicy();
        policy.programmable.recipient = address(0x1234);
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _nativeFeePolicy();
        policy.providerId = _hash("fake-partner");
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _nativeFeePolicy();
        policy.publicPolicyBindingHash = bytes32(0);
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);
    }

    function test_partnerPolicyRejectsExtraTenWrongSplitBasisRecipientStatusAndClaimCollision() public {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _partnerFeePolicy();
        policy.nativeCustomFeeBps = 10;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _partnerFeePolicy();
        policy.partner.shareBps = 14;
        policy.totalFeeBps = 19;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _partnerFeePolicy();
        policy.partner.basisId = _hash("different-basis");
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _partnerFeePolicy();
        policy.partner.currency = address(0xD1FF);
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _partnerFeePolicy();
        policy.partner.roundingId = _hash("different-rounding");
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _partnerFeePolicy();
        policy.partner.recipient = PROGRAMMABLE_RECIPIENT;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _partnerFeePolicy();
        policy.paused = true;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _partnerFeePolicy();
        policy.partner.claimRightId = policy.programmable.claimRightId;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _partnerFeePolicy();
        policy.accountingSafetyEvidenceHash = bytes32(0);
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);
    }

    function test_noQualifyingMarketRequiresExactZeroEconomicsButPreservesEvidence() public view {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _noQualifyingMarketFeePolicy();
        assertEq(feeVerifier.verify(policy), 0x9d8e24dcb7e7e689fd258fe7b1a579d0a210c870a0ead507f5c7ae9886d4d490);
        assertTrue(policy.verificationEvidenceHash != bytes32(0));
        assertEq(policy.totalFeeBps, 0);
        assertEq(policy.programmable.recipient, address(0));
    }

    function test_noQualifyingMarketRejectsHiddenFeeRecipientTemplatePartnerAndActivation() public {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _noQualifyingMarketFeePolicy();
        policy.programmable.shareBps = 1;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _noQualifyingMarketFeePolicy();
        policy.programmable.recipient = PROGRAMMABLE_RECIPIENT;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _noQualifyingMarketFeePolicy();
        policy.templateId = _hash("hidden-fee-template");
        policy.templateVersion = _hash("v1");
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _noQualifyingMarketFeePolicy();
        policy.providerId = _hash("hidden-partner");
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);

        policy = _noQualifyingMarketFeePolicy();
        policy.activationBlock = 100;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
        feeVerifier.verify(policy);
    }

    function testFuzz_nativePolicyAcceptsOnlyTenBps(uint16 rate) public {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _nativeFeePolicy();
        policy.programmable.shareBps = rate;
        policy.totalFeeBps = rate;
        policy.nativeCustomFeeBps = rate;
        if (rate == 10) {
            assertTrue(feeVerifier.verify(policy) != bytes32(0));
        } else {
            vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
            feeVerifier.verify(policy);
        }
    }

    function testFuzz_partnerPolicyAcceptsOnlyFifteenFive(uint8 partnerRate, uint8 programmableRate) public {
        partnerRate = uint8(bound(partnerRate, 0, 20));
        programmableRate = uint8(bound(programmableRate, 0, 20));
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _partnerFeePolicy();
        policy.partner.shareBps = partnerRate;
        policy.programmable.shareBps = programmableRate;
        policy.totalFeeBps = uint16(partnerRate) + programmableRate;
        if (partnerRate == 15 && programmableRate == 5) {
            assertTrue(feeVerifier.verify(policy) != bytes32(0));
        } else {
            vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV1.InvalidFeePolicy.selector);
            feeVerifier.verify(policy);
        }
    }

    function _registerAndFinalize(string memory label)
        private
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration = _nativeRegistration(label);
        _register(registration);
        vm.roll(104);
        bytes32 observedHash = _hash(string.concat(label, "-observed-block"));
        bytes32 confirmedHash = _hash(string.concat(label, "-confirmed-block"));
        vm.setBlockhash(100, observedHash);
        vm.setBlockhash(103, confirmedHash);
        vm.prank(FINALIZER);
        registry.finalizeLaunch(
            _finalityProof(registration, observedHash, confirmedHash, _hash(string.concat(label, "-finality-evidence")))
        );
    }

    function _nativeRegistration(string memory label)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration = _baseRegistration(label);
        registration.templateId = _hash(string.concat(label, "-template"));
        registration.templateVersion = _hash("template-v1");
        registration.feePolicy = _nativeFeePolicy();
        registration.feePolicy.modelId = registration.modelId;
        registration.feePolicy.modelVersion = registration.modelVersion;
        registration.feePolicy.templateId = registration.templateId;
        registration.feePolicy.templateVersion = registration.templateVersion;
        registration.feePolicy.marketPathId = registration.marketPathId;
        _reidentifyAndRebind(registration);
    }

    function _partnerRegistration(string memory label)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration = _baseRegistration(label);
        registration.feePolicy = _partnerFeePolicy();
        registration.feePolicy.templateId = _hash(string.concat(label, "-template-id"));
        registration.feePolicy.templateVersion = _hash(string.concat(label, "-template-version"));
        registration.feePolicy.partnerRepositoryId = registration.repositoryId;
        registration.feePolicy.partnerCommitId = registration.commitId;
        registration.feePolicy.partnerRuntimeCodeSetHash = registration.runtimeCodeSetHash;
        registration.feePolicy.verificationEvidenceHash = _hash(string.concat(label, "-fee-evidence"));
        registration.providerId = registration.feePolicy.providerId;
        registration.templateId = registration.feePolicy.templateId;
        registration.templateVersion = registration.feePolicy.templateVersion;
        registration.feePolicy.modelId = registration.modelId;
        registration.feePolicy.modelVersion = registration.modelVersion;
        registration.marketPathId = _hash(string.concat(label, "-market-path"));
        registration.feePolicy.marketPathId = registration.marketPathId;
        _reidentifyAndRebind(registration);
    }

    function _baseRegistration(string memory label)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration.chainId = 1;
        registration.registryGeneration = GENERATION;
        registration.launchId = _hash(string.concat(label, "-public-launch-id"));
        registration.projectId = _hash(string.concat(label, "-project"));
        registration.approvalId = _hash(string.concat(label, "-approval"));
        registration.repositoryId = _hash(string.concat(label, "-repository"));
        registration.commitId = _hash(string.concat(label, "-commit"));
        registration.sourceCommitment = _hash(string.concat(label, "-source"));
        registration.buildCommitment = _hash(string.concat(label, "-build"));
        registration.artifactSetHash = _hash(string.concat(label, "-artifacts"));
        registration.deploymentConfigurationHash = _hash(string.concat(label, "-deployment-config"));
        registration.configurationHash = _hash(string.concat(label, "-configuration"));
        registration.permissionsHash = _hash(string.concat(label, "-permissions"));
        registration.deploymentId = _hash(string.concat(label, "-deployment-id"));
        registration.deploymentSetHash = _hash(string.concat(label, "-deployments"));
        registration.runtimeCodeSetHash = _hash(string.concat(label, "-runtimes"));
        registration.primaryContract = address(runtimeTarget);
        registration.primaryRuntimeCodeHash = address(runtimeTarget).codehash;
        registration.launchWallet = address(0x1A00);
        registration.modelId = _hash("generic-custom-model");
        registration.modelVersion = _hash("model-v1");
        registration.builderAttributionHash = _hash(string.concat(label, "-builder"));
        registration.originHash = _hash(string.concat(label, "-origin"));
        registration.assetSetHash = _hash(string.concat(label, "-assets"));
        registration.marketSetHash = _hash(string.concat(label, "-markets"));
        registration.marketPathId = _hash(string.concat(label, "-market-path"));
        registration.capabilitySetHash = _hash(string.concat(label, "-capabilities"));
        registration.reviewPolicyHash = _hash("published-security-policy-v1");
        registration.securityReviewHash = _hash(string.concat(label, "-security-review"));
        registration.reviewResultId = _hash("reviewed-exact-deployment");
        registration.finalityPolicyHash = _hash("native-blockhash-depth-v1");
    }

    function _nativeFeePolicy() private pure returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy) {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NativeCustom;
        policy.totalFeeBps = 10;
        policy.nativeCustomFeeBps = 10;
        policy.publicPolicyBindingHash = _hash("native-public-policy-binding");
        policy.modelId = _hash("generic-custom-model");
        policy.modelVersion = _hash("model-v1");
        policy.templateId = _hash("native-template-placeholder");
        policy.templateVersion = _hash("template-v1");
        policy.marketPathId = _hash("native-market-path");
        policy.programmable = _activeLeg(10, PROGRAMMABLE_RECIPIENT, FEE_CURRENCY, "programmable");
        policy.claimIsolationEvidenceHash = _hash("native-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("native-accounting-safety");
        policy.verificationEvidenceHash = _hash("native-verification-evidence");
    }

    function _partnerFeePolicy() private pure returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy) {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.PartnerTemplate;
        policy.providerId = keccak256("aeon");
        policy.partnerStatusId = keccak256("programmable.partner-status.active.v1");
        policy.modelId = _hash("generic-custom-model");
        policy.modelVersion = _hash("model-v1");
        policy.templateId = _hash("synthetic-partner-template");
        policy.templateVersion = _hash("partner-template-v1");
        policy.marketPathId = _hash("aeon-market-path");
        policy.partnerRepositoryId = _hash("partner-repository");
        policy.partnerCommitId = _hash("partner-commit");
        policy.partnerRuntimeCodeSetHash = _hash("partner-runtimes");
        policy.totalFeeBps = 20;
        policy.nativeCustomFeeBps = 0;
        policy.publicPolicyBindingHash = _hash("partner-public-policy-binding");
        policy.partner = _activeLeg(15, PARTNER_RECIPIENT, FEE_CURRENCY, "partner");
        policy.programmable = _activeLeg(5, PROGRAMMABLE_RECIPIENT, FEE_CURRENCY, "programmable");
        policy.partner.chargeModeId = policy.programmable.chargeModeId;
        policy.partner.basisId = policy.programmable.basisId;
        policy.partner.roundingId = policy.programmable.roundingId;
        policy.activationVersion = _hash("partner-activation-v1");
        policy.activationBlock = 50;
        policy.claimIsolationEvidenceHash = _hash("partner-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("partner-accounting-safety");
        policy.verificationEvidenceHash = _hash("partner-verification-evidence");
    }

    function _noQualifyingMarketFeePolicy()
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy)
    {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NoQualifyingMarket;
        policy.publicPolicyBindingHash = 0x6ce49c7599693b5ff58a3c3d3858a2f2866a966d98cd0c06edb4f70a39e4bbaa;
        policy.claimIsolationEvidenceHash = _hash("no-market-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("no-market-accounting-safety");
        policy.verificationEvidenceHash = _hash("no-market-verification-evidence");
    }

    function _activeLeg(uint16 shareBps, address recipient, address currency, string memory label)
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeeLegV1 memory leg)
    {
        leg.shareBps = shareBps;
        leg.recipient = recipient;
        leg.currency = currency;
        leg.chargeModeId = _hash("verified-official-market-path");
        leg.basisId = _hash("actual-settled-market-basis");
        leg.roundingId = _hash("cumulative-floor");
        leg.accrualId = _hash(string.concat(label, "-accrual"));
        leg.claimId = _hash(string.concat(label, "-claim"));
        leg.claimRightId = _hash(string.concat(label, "-claim-right"));
        leg.controlEvidenceHash = _hash(string.concat(label, "-control-evidence"));
    }

    function _reidentifyAndRebind(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private view {
        _rebind(registration);
    }

    function _authorization(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
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
            registrationBindingHash: registry.computeRegistrationBindingHash(
                registration, registry.computeFeePolicyHash(registration.feePolicy)
            ),
            validAfterBlock: uint64(block.number),
            expiresAtBlock: uint64(block.number + 200),
            evidenceHash: keccak256(abi.encode("approval-evidence", registration.approvalId))
        });
    }

    function _authorize(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private {
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory authorization = _authorization(registration);
        vm.prank(APPROVER);
        registry.authorizeApproval(authorization);
    }

    function _register(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private {
        if (registration.providerId != bytes32(0)) {
            _authorizePartnerFactory(registration);
            _rebind(registration);
        }
        _authorize(registration);
        if (registration.providerId == bytes32(0)) {
            vm.prank(WRITER);
            registry.registerLaunch(registration);
        } else {
            partnerFactory.register(registry, registration);
        }
    }

    function _authorizePartnerFactory(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private {
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization =
            _partnerFactoryAuthorization(registration);
        authorization.configurationHash = partnerFactoryRegistry.computeConfigurationHash(authorization);
        registration.configurationHash = authorization.configurationHash;
        vm.prank(APPROVER);
        partnerFactoryRegistry.authorizeFactory(authorization);
    }

    function _partnerFactoryAuthorization(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization)
    {
        authorization = IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1({
            chainId: registration.chainId,
            registryGeneration: registration.registryGeneration,
            configurationHash: bytes32(0),
            providerId: registration.providerId,
            modelId: registration.modelId,
            modelVersion: registration.modelVersion,
            templateId: registration.templateId,
            templateVersion: registration.templateVersion,
            modelRepositoryId: registration.repositoryId,
            modelSourceCommitId: registration.commitId,
            factorySourceRepositoryId: _hash("aeon-factory-repository"),
            factorySourceCommitId: _hash("aeon-factory-source-commit"),
            factory: address(partnerFactory),
            factoryRuntimeCodeHash: address(partnerFactory).codehash,
            launchRuntimeCodeSetHash: registration.runtimeCodeSetHash,
            permissionsHash: registration.permissionsHash,
            feePolicyHash: registry.computeFeePolicyHash(registration.feePolicy),
            validAfterBlock: uint64(block.number),
            expiresAtBlock: uint64(block.number + 200),
            evidenceHash: keccak256(abi.encode("partner-factory-evidence", registration.launchId))
        });
    }

    function _atomicRequest(string memory label, uint256 configuredValue)
        private
        view
        returns (ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request)
    {
        request.salt = _hash(string.concat(label, "-salt"));
        request.creationCode = type(AtomicLaunchTargetV1).creationCode;
        request.initializationCall = abi.encodeCall(AtomicLaunchTargetV1.initialize, (configuredValue));
        request.initializationResultHash = keccak256(abi.encode(keccak256(abi.encode(configuredValue))));
        request.registration = _nativeRegistration(label);
        request.registration.primaryContract =
            atomicRegistrar.predictAddress(request.salt, keccak256(request.creationCode));
        request.registration.primaryRuntimeCodeHash = keccak256(type(AtomicLaunchTargetV1).runtimeCode);
        request.registration.launchWallet = address(this);
        request.registration.deploymentConfigurationHash = atomicRegistrar.computeAtomicRequestCommitment(request);
        _rebind(request.registration);
    }

    function _rebind(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private view {
        bytes32 feePolicyHash = registry.computeFeePolicyHash(registration.feePolicy);
        registration.approvalBindingHash = registry.computeApprovalBindingHash(registration, feePolicyHash);
        registration.reviewDeploymentBindingHash =
            registry.computeReviewDeploymentBindingHash(registration, feePolicyHash);
        registration.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(registration, feePolicyHash);
    }

    function _finalityProof(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        bytes32 observedBlockHash,
        bytes32 confirmedHeadBlockHash,
        bytes32 evidenceHash
    ) private pure returns (IProgrammableCustomRegistryV1.FinalityProofV1 memory proof) {
        proof.chainId = registration.chainId;
        proof.registryGeneration = registration.registryGeneration;
        proof.launchId = registration.launchId;
        proof.observedBlockNumber = 100;
        proof.observedBlockHash = observedBlockHash;
        proof.observedTransactionHash = _hash("finalizer-attested-observed-transaction");
        proof.observedTransactionIndex = 1;
        proof.observedLogIndex = 2;
        proof.confirmedHeadBlockNumber = 103;
        proof.confirmedHeadBlockHash = confirmedHeadBlockHash;
        proof.finalityPolicyHash = registration.finalityPolicyHash;
        proof.finalityEvidenceHash = evidenceHash;
    }

    function _hash(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _registryConfig(uint64 minimumFinalityBlocks, bytes32 chainProfileHash)
        private
        pure
        returns (ProgrammableCustomRegistryV1.RegistryConfigV1 memory config)
    {
        config = ProgrammableCustomRegistryV1.RegistryConfigV1({
            initialAdminDelay: 2 days,
            initialAdmin: ADMIN,
            initialApprover: APPROVER,
            initialWriter: WRITER,
            initialFinalizer: FINALIZER,
            initialCorrector: CORRECTOR,
            initialRevoker: REVOKER,
            registryGeneration: GENERATION,
            minimumFinalityBlocks: minimumFinalityBlocks,
            chainProfileHash: chainProfileHash,
            registryPolicyHash: _hash("registry-policy")
        });
    }
}
