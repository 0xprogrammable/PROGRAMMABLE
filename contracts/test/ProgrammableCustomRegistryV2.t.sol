// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import {
    ProgrammableCustomFeePolicyVerifierLibV2,
    ProgrammableCustomFeePolicyVerifierV2
} from "../src/ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "../src/ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";
import { ProgrammableCustomRegistryV2 } from "../src/ProgrammableCustomRegistryV2.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "../src/interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";

contract CustomRuntimeTargetV2 {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract FutureProviderFactoryV2 {
    function register(
        IProgrammableCustomRegistryV1 registry,
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 calldata registration
    ) external {
        registry.registerLaunch(registration);
    }
}

contract ProgrammableCustomRegistryV2Test is Test {
    uint64 private constant GENERATION = 2;
    address private constant PROGRAMMABLE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address private constant PARTNER_RECIPIENT = address(0xBEEF);
    address private constant FEE_CURRENCY = address(0xCAFE);
    address private constant ADMIN = address(0xA001);
    address private constant REGISTRY_APPROVER = address(0xA002);
    address private constant WRITER = address(0xA003);
    address private constant FINALIZER = address(0xA004);
    address private constant CORRECTOR = address(0xA005);
    address private constant REGISTRY_REVOKER = address(0xA006);
    address private constant FACTORY_APPROVER = address(0xB001);
    address private constant FACTORY_REVOKER = address(0xB002);

    ProgrammableCustomFeePolicyVerifierV2 internal verifier;
    ProgrammableCustomPartnerFactoryRegistryV2 internal factoryRegistry;
    ProgrammableCustomRegistryV2 internal registry;
    FutureProviderFactoryV2 internal providerFactory;
    FutureProviderFactoryV2 internal wrongFactory;
    CustomRuntimeTargetV2 internal runtimeTarget;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        verifier = new ProgrammableCustomFeePolicyVerifierV2();
        factoryRegistry =
            new ProgrammableCustomPartnerFactoryRegistryV2(2 days, ADMIN, FACTORY_APPROVER, FACTORY_REVOKER);
        registry = new ProgrammableCustomRegistryV2(_registryConfig(), factoryRegistry, verifier);
        providerFactory = new FutureProviderFactoryV2();
        wrongFactory = new FutureProviderFactoryV2();
        runtimeTarget = new CustomRuntimeTargetV2();
    }

    function test_generationTwoIsPinnedAndV1InterfaceIsRetained() public view {
        assertEq(registry.REGISTRY_GENERATION(), GENERATION);
        assertEq(factoryRegistry.REGISTRY_GENERATION(), GENERATION);
        assertEq(address(registry.FEE_POLICY_VERIFIER()), address(verifier));
        assertEq(address(registry.PARTNER_FACTORY_REGISTRY()), address(factoryRegistry));
        assertTrue(registry.supportsInterface(type(IProgrammableCustomRegistryV1).interfaceId));
    }

    function test_providerNeutralVerifierAcceptsUnknownFutureProviderStructure() public view {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _partnerPolicy(_hash("future-provider"));
        assertTrue(verifier.verify(policy) != bytes32(0));
    }

    function test_nativeRegistrationThroughWriterConsumesExactApproval() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _nativeRegistration("native-generation-two");
        _rebind(registration);
        _authorizeApproval(registration);

        vm.prank(WRITER);
        registry.registerLaunch(registration);

        assertEq(
            uint8(registry.launchState(registration.launchId).status),
            uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed)
        );
        assertTrue(registry.approvalConsumed(registration.approvalId));
        assertTrue(registry.deploymentConsumed(registration.deploymentId));
        assertEq(registry.launchState(registration.launchId).feePolicyHash, verifier.verify(registration.feePolicy));
    }

    function test_unknownFutureProviderRegistersOnlyThroughExactAuthorizedFactory() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("future-provider-success", _hash("provider-never-seen-before"));
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        providerFactory.register(registry, registration);

        IProgrammableCustomRegistryV1.LaunchStateV1 memory state = registry.launchState(registration.launchId);
        IProgrammableCustomRegistryV1.LaunchDetailsV1 memory details = registry.launchDetails(registration.launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed));
        assertEq(details.providerId, registration.providerId);
        assertEq(state.feePolicyHash, verifier.verify(registration.feePolicy));
        assertEq(registration.feePolicy.totalFeeBps, 20);
        assertEq(registration.feePolicy.partner.shareBps, 15);
        assertEq(registration.feePolicy.programmable.shareBps, 5);
        assertEq(registration.feePolicy.nativeCustomFeeBps, 0);
    }

    function test_fakeProviderTagWithoutFactoryAuthorizationFailsClosed() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("fake-provider-tag", _hash("fabricated-provider"));
        _rebind(registration);
        _authorizeApproval(registration);

        vm.prank(WRITER);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationNotActive.selector);
        registry.registerLaunch(registration);
    }

    function test_revokedFactoryAuthorizationCannotRegister() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("revoked-factory", _hash("future-provider-revoked"));
        _authorizeFactoryAndApproval(registration, address(providerFactory));

        vm.prank(FACTORY_REVOKER);
        factoryRegistry.revokeFactory(
            registration.configurationHash, _hash("retired"), _hash("factory-revocation-evidence")
        );

        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationNotActive.selector);
        providerFactory.register(registry, registration);
    }

    function test_factoryAuthorizationRejectsCrossGenerationReplay() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("cross-generation", _hash("future-provider-generation"));
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization =
            _factoryAuthorization(registration, address(providerFactory));
        authorization.registryGeneration = 1;
        authorization.configurationHash = factoryRegistry.computeConfigurationHash(authorization);

        vm.prank(FACTORY_APPROVER);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.RegistryScopeMismatch.selector);
        factoryRegistry.authorizeFactory(authorization);
    }

    function test_authorizedRecordRejectsWrongFactoryRuntimePermissionsConfigurationAndFee() public {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        _authorizeFactoryAndApproval(registration, address(providerFactory));
        bytes32 canonicalConfigurationHash = registration.configurationHash;

        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.FactoryCallerMismatch.selector);
        wrongFactory.register(registry, registration);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory mutated =
            _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        mutated.configurationHash = canonicalConfigurationHash;
        mutated.permissionsHash = _hash("wrong-permissions");
        _rebind(mutated);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationMismatch.selector);
        providerFactory.register(registry, mutated);

        mutated = _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        mutated.configurationHash = canonicalConfigurationHash;
        mutated.runtimeCodeSetHash = _hash("wrong-runtime-set");
        mutated.feePolicy.partnerRuntimeCodeSetHash = mutated.runtimeCodeSetHash;
        _rebind(mutated);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationMismatch.selector);
        providerFactory.register(registry, mutated);

        mutated = _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        mutated.configurationHash = _hash("fake-configuration");
        _rebind(mutated);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationNotActive.selector);
        providerFactory.register(registry, mutated);

        mutated = _partnerRegistration("exact-factory-binding", _hash("provider-x"));
        mutated.configurationHash = canonicalConfigurationHash;
        mutated.feePolicy.verificationEvidenceHash = _hash("different-fee-evidence");
        _rebind(mutated);
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.ConfigurationMismatch.selector);
        providerFactory.register(registry, mutated);

        vm.etch(address(providerFactory), hex"60006000fd");
        vm.prank(address(providerFactory));
        vm.expectPartialRevert(ProgrammableCustomPartnerFactoryRegistryV2.FactoryRuntimeMismatch.selector);
        registry.registerLaunch(registration);
    }

    function test_nativePolicyIsExactlyTenBpsAndCannotCarryPartnerOverlay() public {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _nativePolicy();
        assertTrue(verifier.verify(policy) != bytes32(0));

        policy.totalFeeBps = 20;
        policy.programmable.shareBps = 20;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);

        policy = _nativePolicy();
        policy.partner = _activeLeg(15, PARTNER_RECIPIENT, "partner-overlay");
        policy.totalFeeBps = 25;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);
    }

    function test_partnerPolicyRejectsOverlayWrongBasisRecipientAndClaimCollision() public {
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _partnerPolicy(_hash("provider-y"));
        policy.nativeCustomFeeBps = 10;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);

        policy = _partnerPolicy(_hash("provider-y"));
        policy.partner.basisId = _hash("different-basis");
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);

        policy = _partnerPolicy(_hash("provider-y"));
        policy.partner.recipient = PROGRAMMABLE_RECIPIENT;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);

        policy = _partnerPolicy(_hash("provider-y"));
        policy.partner.claimRightId = policy.programmable.claimRightId;
        vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
        verifier.verify(policy);
    }

    function test_configurationCommitmentBindsGenerationAndV2Domain() public view {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration =
            _partnerRegistration("configuration-domain", _hash("provider-z"));
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization =
            _factoryAuthorization(registration, address(providerFactory));
        bytes32 generationTwoHash = factoryRegistry.computeConfigurationHash(authorization);

        authorization.registryGeneration = 1;
        bytes32 generationOneScopedHash = factoryRegistry.computeConfigurationHash(authorization);
        assertTrue(generationTwoHash != generationOneScopedHash);

        authorization.registryGeneration = 2;
        bytes32 modelHash = keccak256(
            abi.encode(
                authorization.providerId,
                authorization.modelId,
                authorization.modelVersion,
                authorization.templateId,
                authorization.templateVersion,
                authorization.modelRepositoryId,
                authorization.modelSourceCommitId
            )
        );
        bytes32 factoryHash = keccak256(
            abi.encode(
                authorization.factorySourceRepositoryId,
                authorization.factorySourceCommitId,
                authorization.chainId,
                authorization.registryGeneration,
                authorization.factory,
                authorization.factoryRuntimeCodeHash,
                authorization.launchRuntimeCodeSetHash
            )
        );
        bytes32 independentlyComputed = keccak256(
            abi.encode(
                keccak256("programmable.custom-partner-configuration.v2"),
                modelHash,
                factoryHash,
                authorization.permissionsHash,
                authorization.feePolicyHash
            )
        );
        assertEq(generationTwoHash, independentlyComputed);
    }

    function test_registrationCommitmentBindsEveryStrongPreimageGroup() public view {
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration = _nativeRegistration("strong-preimage");
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        _rebind(registration);
        bytes32 canonical = registry.computeRegisteredRecordCommitment(registration, feePolicyHash);

        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory mutated = registration;
        mutated.configurationHash = _hash("mutated-configuration");
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
        mutated = registration;
        mutated.permissionsHash = _hash("mutated-permissions");
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
        mutated = registration;
        mutated.marketPathId = _hash("mutated-market-path");
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
        mutated = registration;
        mutated.runtimeCodeSetHash = _hash("mutated-runtime-set");
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
        mutated = registration;
        mutated.registryGeneration = 1;
        assertTrue(registry.computeRegisteredRecordCommitment(mutated, feePolicyHash) != canonical);
    }

    function testFuzz_anyNonzeroProviderNeedsExactFifteenFivePolicy(
        bytes32 providerId,
        uint8 partner,
        uint8 programmable
    ) public {
        vm.assume(providerId != bytes32(0));
        partner = uint8(bound(partner, 0, 20));
        programmable = uint8(bound(programmable, 0, 20));
        IProgrammableCustomRegistryV1.FeePolicyV1 memory policy = _partnerPolicy(providerId);
        policy.partner.shareBps = partner;
        policy.programmable.shareBps = programmable;
        policy.totalFeeBps = uint16(partner) + uint16(programmable);
        if (partner == 15 && programmable == 5) {
            assertTrue(verifier.verify(policy) != bytes32(0));
        } else {
            vm.expectPartialRevert(ProgrammableCustomFeePolicyVerifierLibV2.InvalidFeePolicy.selector);
            verifier.verify(policy);
        }
    }

    function _authorizeFactoryAndApproval(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        address factory
    ) private {
        IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory
            authorization = _factoryAuthorization(registration, factory);
        authorization.configurationHash = factoryRegistry.computeConfigurationHash(authorization);
        registration.configurationHash = authorization.configurationHash;
        vm.prank(FACTORY_APPROVER);
        factoryRegistry.authorizeFactory(authorization);
        _rebind(registration);
        _authorizeApproval(registration);
    }

    function _authorizeApproval(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private {
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        bytes32 registrationBindingHash = registry.computeRegistrationBindingHash(registration, feePolicyHash);
        vm.prank(REGISTRY_APPROVER);
        registry.authorizeApproval(
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: registration.chainId,
                registryGeneration: registration.registryGeneration,
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: registrationBindingHash,
                validAfterBlock: uint64(block.number),
                expiresAtBlock: uint64(block.number + 100),
                evidenceHash: keccak256(abi.encode("approval-evidence", registration.approvalId))
            })
        );
    }

    function _factoryAuthorization(
        IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration,
        address factory
    ) private view returns (IProgrammableCustomPartnerFactoryRegistryV1.FactoryAuthorizationV1 memory authorization) {
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
            factorySourceRepositoryId: _hash("provider-factory-repository"),
            factorySourceCommitId: _hash("provider-factory-commit"),
            factory: factory,
            factoryRuntimeCodeHash: factory.codehash,
            launchRuntimeCodeSetHash: registration.runtimeCodeSetHash,
            permissionsHash: registration.permissionsHash,
            feePolicyHash: verifier.verify(registration.feePolicy),
            validAfterBlock: uint64(block.number),
            expiresAtBlock: uint64(block.number + 100),
            evidenceHash: keccak256(abi.encode("factory-evidence", registration.launchId))
        });
    }

    function _nativeRegistration(string memory label)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration = _baseRegistration(label);
        registration.feePolicy = _nativePolicy();
        registration.feePolicy.modelId = registration.modelId;
        registration.feePolicy.modelVersion = registration.modelVersion;
        registration.feePolicy.templateId = registration.templateId;
        registration.feePolicy.templateVersion = registration.templateVersion;
        registration.feePolicy.marketPathId = registration.marketPathId;
    }

    function _partnerRegistration(string memory label, bytes32 providerId)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration = _baseRegistration(label);
        registration.providerId = providerId;
        registration.feePolicy = _partnerPolicy(providerId);
        registration.feePolicy.modelId = registration.modelId;
        registration.feePolicy.modelVersion = registration.modelVersion;
        registration.feePolicy.templateId = registration.templateId;
        registration.feePolicy.templateVersion = registration.templateVersion;
        registration.feePolicy.marketPathId = registration.marketPathId;
        registration.feePolicy.partnerRepositoryId = registration.repositoryId;
        registration.feePolicy.partnerCommitId = registration.commitId;
        registration.feePolicy.partnerRuntimeCodeSetHash = registration.runtimeCodeSetHash;
    }

    function _baseRegistration(string memory label)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration.chainId = block.chainid;
        registration.registryGeneration = GENERATION;
        registration.launchId = _hash(string.concat(label, "-launch"));
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
        registration.deploymentSetHash = _hash(string.concat(label, "-deployment-set"));
        registration.runtimeCodeSetHash = _hash(string.concat(label, "-runtime-set"));
        registration.primaryContract = address(runtimeTarget);
        registration.primaryRuntimeCodeHash = address(runtimeTarget).codehash;
        registration.launchWallet = address(0x1A00);
        registration.modelId = _hash("generic-custom-model");
        registration.modelVersion = _hash("model-v2");
        registration.templateId = _hash(string.concat(label, "-template"));
        registration.templateVersion = _hash("template-v2");
        registration.builderAttributionHash = _hash(string.concat(label, "-builder"));
        registration.originHash = _hash(string.concat(label, "-origin"));
        registration.assetSetHash = _hash(string.concat(label, "-assets"));
        registration.marketSetHash = _hash(string.concat(label, "-markets"));
        registration.marketPathId = _hash(string.concat(label, "-market-path"));
        registration.capabilitySetHash = _hash(string.concat(label, "-capabilities"));
        registration.reviewPolicyHash = _hash("published-security-policy-v2");
        registration.securityReviewHash = _hash(string.concat(label, "-security-review"));
        registration.reviewResultId = _hash("reviewed-exact-deployment");
        registration.finalityPolicyHash = _hash("native-blockhash-depth-v2");
    }

    function _nativePolicy() private pure returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy) {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NativeCustom;
        policy.totalFeeBps = 10;
        policy.nativeCustomFeeBps = 10;
        policy.modelId = _hash("generic-custom-model");
        policy.modelVersion = _hash("model-v2");
        policy.templateId = _hash("native-template");
        policy.templateVersion = _hash("template-v2");
        policy.marketPathId = _hash("native-market-path");
        policy.programmable = _activeLeg(10, PROGRAMMABLE_RECIPIENT, "programmable");
        policy.publicPolicyBindingHash = _hash("native-public-policy");
        policy.claimIsolationEvidenceHash = _hash("native-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("native-accounting-safety");
        policy.verificationEvidenceHash = _hash("native-verification");
    }

    function _partnerPolicy(bytes32 providerId)
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy)
    {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.PartnerTemplate;
        policy.providerId = providerId;
        policy.partnerStatusId = keccak256("programmable.partner-status.active.v1");
        policy.modelId = _hash("generic-custom-model");
        policy.modelVersion = _hash("model-v2");
        policy.templateId = _hash("partner-template");
        policy.templateVersion = _hash("template-v2");
        policy.marketPathId = _hash("partner-market-path");
        policy.partnerRepositoryId = _hash("partner-repository");
        policy.partnerCommitId = _hash("partner-commit");
        policy.partnerRuntimeCodeSetHash = _hash("partner-runtimes");
        policy.totalFeeBps = 20;
        policy.nativeCustomFeeBps = 0;
        policy.partner = _activeLeg(15, PARTNER_RECIPIENT, "partner");
        policy.programmable = _activeLeg(5, PROGRAMMABLE_RECIPIENT, "programmable");
        policy.partner.chargeModeId = policy.programmable.chargeModeId;
        policy.partner.basisId = policy.programmable.basisId;
        policy.partner.roundingId = policy.programmable.roundingId;
        policy.activationVersion = _hash("partner-activation-v2");
        policy.activationBlock = 50;
        policy.publicPolicyBindingHash = _hash("partner-public-policy");
        policy.claimIsolationEvidenceHash = _hash("partner-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("partner-accounting-safety");
        policy.verificationEvidenceHash = _hash("partner-verification");
    }

    function _activeLeg(uint16 shareBps, address recipient, string memory label)
        private
        pure
        returns (IProgrammableCustomRegistryV1.FeeLegV1 memory leg)
    {
        leg.shareBps = shareBps;
        leg.recipient = recipient;
        leg.currency = FEE_CURRENCY;
        leg.chargeModeId = _hash("verified-official-market-path");
        leg.basisId = _hash("actual-settled-market-basis");
        leg.roundingId = _hash("cumulative-floor");
        leg.accrualId = _hash(string.concat(label, "-accrual"));
        leg.claimId = _hash(string.concat(label, "-claim"));
        leg.claimRightId = _hash(string.concat(label, "-claim-right"));
        leg.controlEvidenceHash = _hash(string.concat(label, "-control"));
    }

    function _rebind(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private view {
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        registration.approvalBindingHash = registry.computeApprovalBindingHash(registration, feePolicyHash);
        registration.reviewDeploymentBindingHash =
            registry.computeReviewDeploymentBindingHash(registration, feePolicyHash);
        registration.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(registration, feePolicyHash);
    }

    function _registryConfig() private pure returns (ProgrammableCustomRegistryV1.RegistryConfigV1 memory config) {
        config = ProgrammableCustomRegistryV1.RegistryConfigV1({
            initialAdminDelay: 2 days,
            initialAdmin: ADMIN,
            initialApprover: REGISTRY_APPROVER,
            initialWriter: WRITER,
            initialFinalizer: FINALIZER,
            initialCorrector: CORRECTOR,
            initialRevoker: REGISTRY_REVOKER,
            registryGeneration: GENERATION,
            minimumFinalityBlocks: 3,
            chainProfileHash: _hash("ethereum-mainnet-chain-profile-v2"),
            registryPolicyHash: _hash("registry-policy-v2")
        });
    }

    function _hash(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }
}
