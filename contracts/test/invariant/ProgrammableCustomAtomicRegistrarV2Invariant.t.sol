// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";

import { ProgrammableCustomAtomicRegistrarV1 } from "../../src/ProgrammableCustomAtomicRegistrarV1.sol";
import { ProgrammableCustomAtomicRegistrarV2 } from "../../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomExecutionPolicyRegistryV2 } from "../../src/ProgrammableCustomExecutionPolicyRegistryV2.sol";
import { ProgrammableCustomFeePolicyVerifierV2 } from "../../src/ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "../../src/ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "../../src/ProgrammableCustomRegistryV1.sol";
import { ProgrammableCustomRegistryV2 } from "../../src/ProgrammableCustomRegistryV2.sol";
import { IProgrammableCustomExecutionPolicyV2 } from "../../src/interfaces/IProgrammableCustomExecutionPolicyV2.sol";
import { IProgrammableCustomRegistryV1 } from "../../src/interfaces/IProgrammableCustomRegistryV1.sol";

contract InvariantAtomicLaunchTargetV2 {
    uint256 public configuredValue;

    function initialize(uint256 value) external returns (bytes32 result) {
        require(configuredValue == 0, "already initialized");
        configuredValue = value;
        result = keccak256(abi.encode(value));
    }
}

contract InvariantForceEtherV2 {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

contract ProgrammableCustomAtomicRegistrarV2Handler {
    address internal constant PROGRAMMABLE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant FEE_CURRENCY = address(0xCAFE);

    ProgrammableCustomRegistryV2 public immutable registry;
    ProgrammableCustomFeePolicyVerifierV2 public immutable verifier;
    ProgrammableCustomAtomicRegistrarV2 public immutable registrar;

    uint256 public forcedTotal;
    bytes32[] internal launchedIds;

    constructor(
        ProgrammableCustomRegistryV2 registry_,
        ProgrammableCustomFeePolicyVerifierV2 verifier_,
        ProgrammableCustomAtomicRegistrarV2 registrar_
    ) payable {
        registry = registry_;
        verifier = verifier_;
        registrar = registrar_;
    }

    function forceFund(uint96 rawAmount) external {
        uint256 amount = (uint256(rawAmount) % 1 ether) + 1;
        if (address(this).balance < amount) return;
        forcedTotal += amount;
        new InvariantForceEtherV2{ value: amount }(payable(address(registrar)));
    }

    function launch(uint64 seed) external {
        if (launchedIds.length >= 16) return;
        string memory label = string.concat("invariant-", vmSafeString(seed), "-", vmSafeString(launchedIds.length));
        ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request = _atomicRequest(label, seed);
        _authorize(request.registration);
        registrar.deployInitializeAndRegister(request);
        launchedIds.push(request.registration.launchId);
    }

    function launchedCount() external view returns (uint256) {
        return launchedIds.length;
    }

    function launchedId(uint256 index) external view returns (bytes32) {
        return launchedIds[index];
    }

    function _atomicRequest(string memory label, uint256 configuredValue)
        private
        view
        returns (ProgrammableCustomAtomicRegistrarV1.AtomicLaunchRequestV1 memory request)
    {
        request.salt = _hash(string.concat(label, "-salt"));
        request.creationCode = type(InvariantAtomicLaunchTargetV2).creationCode;
        request.initializationCall = abi.encodeCall(InvariantAtomicLaunchTargetV2.initialize, (configuredValue));
        request.initializationResultHash = keccak256(abi.encode(keccak256(abi.encode(configuredValue))));
        request.registration = _registration(label);
        request.registration.primaryContract = registrar.predictAddress(request.salt, keccak256(request.creationCode));
        request.registration.primaryRuntimeCodeHash = keccak256(type(InvariantAtomicLaunchTargetV2).runtimeCode);
        request.registration.deploymentConfigurationHash = registrar.computeAtomicRequestCommitment(request);
        IProgrammableCustomExecutionPolicyV2.TradeCapabilityV1 memory capability =
            registrar.unsupportedTradeCapabilityV1(request.registration);
        request.registration.capabilitySetHash = registrar.computeTradeCapabilityHashV1(capability);
        _rebind(request.registration);
    }

    function _registration(string memory label)
        private
        view
        returns (IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration)
    {
        registration.chainId = block.chainid;
        registration.registryGeneration = 2;
        registration.launchId = _hash(string.concat(label, "-launch"));
        registration.projectId = _hash(string.concat(label, "-project"));
        registration.approvalId = _hash(string.concat(label, "-approval"));
        registration.repositoryId = _hash(string.concat(label, "-repository"));
        registration.commitId = _hash(string.concat(label, "-commit"));
        registration.sourceCommitment = _hash(string.concat(label, "-source"));
        registration.buildCommitment = _hash(string.concat(label, "-build"));
        registration.artifactSetHash = _hash(string.concat(label, "-artifacts"));
        registration.configurationHash = _hash(string.concat(label, "-configuration"));
        registration.permissionsHash = _hash(string.concat(label, "-permissions"));
        registration.deploymentId = _hash(string.concat(label, "-deployment-id"));
        registration.deploymentSetHash = _hash(string.concat(label, "-deployment-set"));
        registration.runtimeCodeSetHash = _hash(string.concat(label, "-runtime-set"));
        registration.launchWallet = address(this);
        registration.modelId = _hash("unknown-custom-model");
        registration.modelVersion = _hash("model-v2");
        registration.templateId = _hash(string.concat(label, "-template"));
        registration.templateVersion = _hash("template-v2");
        registration.builderAttributionHash = _hash(string.concat(label, "-builder"));
        registration.originHash = _hash(string.concat(label, "-origin"));
        registration.assetSetHash = _hash(string.concat(label, "-assets"));
        registration.marketSetHash = registrar.PROJECT_ONLY_MARKET_SET_HASH();
        registration.marketPathId = bytes32(0);
        registration.capabilitySetHash = _hash(string.concat(label, "-capabilities"));
        registration.reviewPolicyHash = _hash("published-security-policy-v2");
        registration.securityReviewHash = _hash(string.concat(label, "-security-review"));
        registration.reviewResultId = _hash("reviewed-exact-deployment");
        registration.finalityPolicyHash = _hash("native-blockhash-depth-v2");
        registration.feePolicy = _noMarketPolicy();
    }

    function _noMarketPolicy() private pure returns (IProgrammableCustomRegistryV1.FeePolicyV1 memory policy) {
        policy.kind = IProgrammableCustomRegistryV1.FeePolicyKind.NoQualifyingMarket;
        policy.publicPolicyBindingHash = _hash("no-market-public-policy");
        policy.claimIsolationEvidenceHash = _hash("no-market-claim-isolation");
        policy.accountingSafetyEvidenceHash = _hash("no-market-accounting-safety");
        policy.verificationEvidenceHash = _hash("no-market-verification");
    }

    function _rebind(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private view {
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        registration.approvalBindingHash = registry.computeApprovalBindingHash(registration, feePolicyHash);
        registration.reviewDeploymentBindingHash =
            registry.computeReviewDeploymentBindingHash(registration, feePolicyHash);
        registration.registeredRecordCommitment =
            registry.computeRegisteredRecordCommitment(registration, feePolicyHash);
    }

    function _authorize(IProgrammableCustomRegistryV1.LaunchRegistrationV1 memory registration) private {
        bytes32 feePolicyHash = verifier.verify(registration.feePolicy);
        registry.authorizeApproval(
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: registration.chainId,
                registryGeneration: registration.registryGeneration,
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: registry.computeRegistrationBindingHash(registration, feePolicyHash),
                validAfterBlock: uint64(block.number),
                expiresAtBlock: uint64(block.number + 100),
                evidenceHash: _hash(string.concat("approval-evidence-", vmSafeString(launchedIds.length)))
            })
        );
    }

    function vmSafeString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        uint256 remaining = value;
        while (remaining != 0) {
            digits++;
            remaining /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }

    function _hash(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }
}

contract ProgrammableCustomAtomicRegistrarV2Invariant is StdInvariant, Test {
    address internal constant ADMIN = address(0xA001);
    address internal constant APPROVER = address(0xA002);
    address internal constant FINALIZER = address(0xA003);
    address internal constant CORRECTOR = address(0xA004);
    address internal constant REVOKER = address(0xA005);

    ProgrammableCustomRegistryV2 internal registry;
    ProgrammableCustomAtomicRegistrarV2 internal registrar;
    ProgrammableCustomAtomicRegistrarV2Handler internal handler;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        ProgrammableCustomFeePolicyVerifierV2 verifier = new ProgrammableCustomFeePolicyVerifierV2();
        ProgrammableCustomPartnerFactoryRegistryV2 partnerRegistry =
            new ProgrammableCustomPartnerFactoryRegistryV2(2 days, address(0xB001), address(0xB002), address(0xB003));
        uint256 currentNonce = vm.getNonce(address(this));
        address predictedRegistry = vm.computeCreateAddress(address(this), currentNonce + 1);
        address predictedRegistrar = vm.computeCreateAddress(address(this), currentNonce + 2);
        ProgrammableCustomExecutionPolicyRegistryV2 executionPolicyRegistry = new ProgrammableCustomExecutionPolicyRegistryV2(
            IProgrammableCustomRegistryV1(predictedRegistry), partnerRegistry, predictedRegistrar
        );
        registry = new ProgrammableCustomRegistryV2(
            ProgrammableCustomRegistryV1.RegistryConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: ADMIN,
                initialApprover: APPROVER,
                initialWriter: predictedRegistrar,
                initialFinalizer: FINALIZER,
                initialCorrector: CORRECTOR,
                initialRevoker: REVOKER,
                registryGeneration: 2,
                minimumFinalityBlocks: 3,
                chainProfileHash: keccak256("invariant-chain-profile"),
                registryPolicyHash: keccak256("invariant-registry-policy")
            }),
            partnerRegistry,
            verifier,
            executionPolicyRegistry
        );
        registrar = new ProgrammableCustomAtomicRegistrarV2(registry, executionPolicyRegistry);
        assertEq(address(registrar), predictedRegistrar);
        vm.deal(address(this), 1000 ether);
        handler = new ProgrammableCustomAtomicRegistrarV2Handler{ value: 1000 ether }(registry, verifier, registrar);

        bytes32 approverRole = registry.APPROVER_ROLE();
        vm.prank(ADMIN);
        registry.grantRole(approverRole, address(handler));

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = handler.forceFund.selector;
        selectors[1] = handler.launch.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function invariant_forcedEtherNeverBlocksAtomicLaunchesOrLeaksIntoThem() public view {
        assertEq(address(registrar).balance, handler.forcedTotal());
        uint256 count = handler.launchedCount();
        for (uint256 index; index < count; index++) {
            assertEq(uint8(registry.launchState(handler.launchedId(index)).status), 1);
        }
    }
}
