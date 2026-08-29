// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { CoreV1 } from "../../src/core/CoreV1.sol";
import { ProtocolAssessmentV1 } from "../../src/core/ProtocolAssessmentV1.sol";
import {
    DomainRevisionDescriptorV1,
    EngineRevisionDescriptorV1,
    MarketDescriptorV1
} from "../../src/core/NativeIdentityV1.sol";
import { OpaqueStateEngineV1 } from "../../src/reference-engines/OpaqueStateEngineV1.sol";
import { AssessmentHarness } from "../helpers/AssessmentHarness.sol";
import { CoreTestFixtures } from "../helpers/CoreTestFixtures.sol";
import { IdentityHarness } from "../helpers/IdentityHarness.sol";

contract IdentityAndAssessmentFuzzTest is Test {
    CoreV1 internal core;
    OpaqueStateEngineV1 internal engine;
    AssessmentHarness internal assessment;
    IdentityHarness internal identities;

    function setUp() external {
        core = new CoreV1(CoreTestFixtures.CONSTITUTION_ID, CoreTestFixtures.COLLECTOR);
        engine = new OpaqueStateEngineV1();
        assessment = new AssessmentHarness();
        identities = new IdentityHarness();
    }

    function testFuzz_assessmentFragmentationInvariant(uint128 first, uint128 second, uint128 startingBasis)
        external
        view
    {
        // Safe: every bound upper limit is within uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        first = uint128(bound(first, 0, type(uint128).max / 4));
        // Safe: every bound upper limit is within uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        second = uint128(bound(second, 0, type(uint128).max / 4));
        // Safe: every bound upper limit is within uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        startingBasis = uint128(bound(startingBasis, 0, type(uint128).max / 2));

        ProtocolAssessmentV1.Delta memory firstResult = assessment.applyBasisDelta(startingBasis, first);
        ProtocolAssessmentV1.Delta memory secondResult =
            assessment.applyBasisDelta(firstResult.cumulativeBasisAfter, second);
        ProtocolAssessmentV1.Delta memory merged = assessment.applyBasisDelta(startingBasis, first + second);

        assertEq(firstResult.assessmentDelta + secondResult.assessmentDelta, merged.assessmentDelta);
        assertEq(secondResult.cumulativeBasisAfter, merged.cumulativeBasisAfter);
    }

    function testFuzz_engineRevisionIdentityChangesWithEveryBoundField(bytes32 replacement, uint8 field) external view {
        vm.assume(replacement != bytes32(0));
        EngineRevisionDescriptorV1 memory original = CoreTestFixtures.engineDescriptor(core, address(engine));
        bytes32 originalId = core.deriveEngineRevisionId(original);

        // Safe: bound restricts the value to 0...8.
        // forge-lint: disable-next-line(unsafe-typecast)
        field = uint8(bound(field, 0, 8));
        if (field == 0) {
            uint256 changedChainId = uint256(replacement);
            vm.assume(changedChainId != original.chainId);
            original.chainId = changedChainId;
        } else if (field == 1) {
            // Intentional: native EVM addresses are the low 160 bits.
            // forge-lint: disable-next-line(unsafe-typecast)
            address changedEngine = address(uint160(uint256(replacement)));
            vm.assume(changedEngine != original.engine);
            original.engine = changedEngine;
        } else if (field == 2) {
            vm.assume(replacement != original.runtimeCodeHash);
            original.runtimeCodeHash = replacement;
        } else if (field == 3) {
            vm.assume(replacement != original.interfaceProfileId);
            original.interfaceProfileId = replacement;
        } else if (field == 4) {
            vm.assume(replacement != original.selectorSetHash);
            original.selectorSetHash = replacement;
        } else if (field == 5) {
            vm.assume(replacement != original.codePolicyId);
            original.codePolicyId = replacement;
        } else if (field == 6) {
            vm.assume(replacement != original.immutableConfigurationCommitment);
            original.immutableConfigurationCommitment = replacement;
        } else if (field == 7) {
            vm.assume(replacement != original.dependencyPolicyCommitment);
            original.dependencyPolicyCommitment = replacement;
        } else {
            vm.assume(replacement != original.capabilityProfileCommitment);
            original.capabilityProfileCommitment = replacement;
        }

        assertNotEq(core.deriveEngineRevisionId(original), originalId);
    }

    function testFuzz_marketIdentityIsSensitiveToAuthorityCommitments(bytes32 replacement, uint8 field) external {
        vm.assume(replacement != bytes32(0));
        EngineRevisionDescriptorV1 memory engineDescriptor = CoreTestFixtures.engineDescriptor(core, address(engine));
        bytes32 engineRevisionId = core.registerEngineRevision(engineDescriptor);
        MarketDescriptorV1 memory original = CoreTestFixtures.marketDescriptor(engineRevisionId);
        bytes32 originalId = core.deriveMarketId(original);

        // Safe: bound restricts the value to 0...4.
        // forge-lint: disable-next-line(unsafe-typecast)
        field = uint8(bound(field, 0, 4));
        if (field == 0) {
            vm.assume(replacement != original.engineRevisionId);
            original.engineRevisionId = replacement;
        } else if (field == 1) {
            vm.assume(replacement != original.immutableParametersCommitment);
            original.immutableParametersCommitment = replacement;
        } else if (field == 2) {
            vm.assume(replacement != original.domainAdmissionPolicyCommitment);
            original.domainAdmissionPolicyCommitment = replacement;
        } else if (field == 3) {
            vm.assume(replacement != original.assetAdmissionPolicyCommitment);
            original.assetAdmissionPolicyCommitment = replacement;
        } else {
            vm.assume(replacement != original.requiredCapabilityProfileCommitment);
            original.requiredCapabilityProfileCommitment = replacement;
        }

        assertNotEq(core.deriveMarketId(original), originalId);
    }

    function testFuzz_domainRevisionIdentityChangesWithEveryBoundField(bytes32 replacement, uint8 field) external view {
        vm.assume(replacement != bytes32(0));
        DomainRevisionDescriptorV1 memory original = CoreTestFixtures.domainDescriptor(keccak256("domain.original"));
        bytes32 originalId = core.deriveDomainRevisionId(original);

        // Safe: bound restricts the value to 0...5.
        // forge-lint: disable-next-line(unsafe-typecast)
        field = uint8(bound(field, 0, 5));
        if (field == 0) {
            vm.assume(replacement != original.domainId);
            original.domainId = replacement;
        } else if (field == 1) {
            vm.assume(replacement != original.admissionPolicyCommitment);
            original.admissionPolicyCommitment = replacement;
        } else if (field == 2) {
            vm.assume(replacement != original.custodyProfileId);
            original.custodyProfileId = replacement;
        } else if (field == 3) {
            vm.assume(replacement != original.exitProfileId);
            original.exitProfileId = replacement;
        } else if (field == 4) {
            vm.assume(replacement != original.authorityPolicyCommitment);
            original.authorityPolicyCommitment = replacement;
        } else {
            vm.assume(replacement != original.immutableConfigurationCommitment);
            original.immutableConfigurationCommitment = replacement;
        }

        assertNotEq(core.deriveDomainRevisionId(original), originalId);
    }

    function testFuzz_coreDeploymentIdentityChangesWithEveryVariableField(bytes32 replacement, uint8 field)
        external
        view
    {
        vm.assume(replacement != bytes32(0));
        uint256 chainId = block.chainid;
        address coreAddress = address(core);
        bytes32 constitutionId = CoreTestFixtures.CONSTITUTION_ID;
        uint32 major = 1;
        address collector = CoreTestFixtures.COLLECTOR;
        bytes32 original = identities.coreDeploymentId(chainId, coreAddress, constitutionId, major, collector);

        // Safe: bound restricts the value to 0...4.
        // forge-lint: disable-next-line(unsafe-typecast)
        field = uint8(bound(field, 0, 4));
        if (field == 0) {
            chainId = uint256(replacement);
            vm.assume(chainId != block.chainid);
        } else if (field == 1) {
            // Intentional: native EVM addresses are the low 160 bits.
            // forge-lint: disable-next-line(unsafe-typecast)
            coreAddress = address(uint160(uint256(replacement)));
            vm.assume(coreAddress != address(core));
        } else if (field == 2) {
            constitutionId = replacement;
            vm.assume(constitutionId != CoreTestFixtures.CONSTITUTION_ID);
        } else if (field == 3) {
            // Intentional: the bound field itself is uint32.
            // forge-lint: disable-next-line(unsafe-typecast)
            major = uint32(uint256(replacement));
            vm.assume(major != 1);
        } else {
            // Intentional: native EVM addresses are the low 160 bits.
            // forge-lint: disable-next-line(unsafe-typecast)
            collector = address(uint160(uint256(replacement)));
            vm.assume(collector != CoreTestFixtures.COLLECTOR);
        }

        assertNotEq(identities.coreDeploymentId(chainId, coreAddress, constitutionId, major, collector), original);
    }

    function testFuzz_vaultIdentityChangesWithEveryTupleField(bytes32 replacement, uint8 field) external view {
        vm.assume(replacement != bytes32(0));
        bytes32 coreDeploymentId = core.CORE_DEPLOYMENT_ID();
        bytes32 domainRevisionId = keccak256("domain revision");
        bytes32 assetProfileId = core.STRICT_MEASURED_ERC20_ASSET_PROFILE_ID();
        address nativeAsset = address(engine);
        bytes32 original = identities.vaultId(coreDeploymentId, domainRevisionId, assetProfileId, nativeAsset);

        // Safe: bound restricts the value to 0...3.
        // forge-lint: disable-next-line(unsafe-typecast)
        field = uint8(bound(field, 0, 3));
        if (field == 0) {
            vm.assume(replacement != coreDeploymentId);
            coreDeploymentId = replacement;
        } else if (field == 1) {
            vm.assume(replacement != domainRevisionId);
            domainRevisionId = replacement;
        } else if (field == 2) {
            vm.assume(replacement != assetProfileId);
            assetProfileId = replacement;
        } else {
            // Intentional: native EVM addresses are the low 160 bits.
            // forge-lint: disable-next-line(unsafe-typecast)
            address changedAsset = address(uint160(uint256(replacement)));
            vm.assume(changedAsset != nativeAsset);
            nativeAsset = changedAsset;
        }

        assertNotEq(identities.vaultId(coreDeploymentId, domainRevisionId, assetProfileId, nativeAsset), original);
    }

    function testFuzz_domainRevisionAndVaultTupleNeverAlias(bytes32 firstDomain, bytes32 secondDomain, address token)
        external
        view
    {
        vm.assume(firstDomain != bytes32(0));
        vm.assume(secondDomain != bytes32(0));
        vm.assume(firstDomain != secondDomain);
        vm.assume(token != address(0));

        DomainRevisionDescriptorV1 memory first = CoreTestFixtures.domainDescriptor(firstDomain);
        DomainRevisionDescriptorV1 memory second = CoreTestFixtures.domainDescriptor(secondDomain);
        bytes32 firstRevision = core.deriveDomainRevisionId(first);
        bytes32 secondRevision = core.deriveDomainRevisionId(second);
        assertNotEq(firstRevision, secondRevision);

        bytes32 profile = core.STRICT_MEASURED_ERC20_ASSET_PROFILE_ID();
        assertNotEq(
            core.deriveVaultId(firstRevision, profile, token), core.deriveVaultId(secondRevision, profile, token)
        );
    }
}
