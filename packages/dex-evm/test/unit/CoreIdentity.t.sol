// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";

import { CoreV1 } from "../../src/core/CoreV1.sol";
import { DomainVaultV1 } from "../../src/core/DomainVaultV1.sol";
import {
    DomainRevisionDescriptorV1,
    EngineRevisionDescriptorV1,
    MarketDescriptorV1
} from "../../src/core/NativeIdentityV1.sol";
import { OpaqueStateEngineV1 } from "../../src/reference-engines/OpaqueStateEngineV1.sol";
import { CoreTestFixtures } from "../helpers/CoreTestFixtures.sol";

contract CoreIdentityTest is Test {
    CoreV1 internal core;
    OpaqueStateEngineV1 internal engine;

    function setUp() external {
        core = new CoreV1(CoreTestFixtures.CONSTITUTION_ID, CoreTestFixtures.COLLECTOR);
        engine = new OpaqueStateEngineV1();
    }

    function test_constructorBindsDirectImmutableIdentity() external view {
        bytes32 deploymentTypehash = keccak256(
            "CoreDeploymentV1(bytes32 runtimeId,uint256 chainId,address core,bytes32 constitutionId,uint32 coreMajor,address collector)"
        );
        bytes32 expected = keccak256(
            abi.encode(
                deploymentTypehash,
                keccak256("programmable.runtime.evm.v1"),
                block.chainid,
                address(core),
                CoreTestFixtures.CONSTITUTION_ID,
                uint32(1),
                CoreTestFixtures.COLLECTOR
            )
        );

        assertEq(core.CORE_DEPLOYMENT_ID(), expected);
        assertEq(core.CONSTITUTION_ID(), CoreTestFixtures.CONSTITUTION_ID);
        assertEq(core.COLLECTOR(), CoreTestFixtures.COLLECTOR);
        assertEq(core.DEPLOYMENT_CHAIN_ID(), block.chainid);
        assertEq(core.currentRuntimeCodeHash(), address(core).codehash);
        assertTrue(address(core).code.length != 0);
    }

    function test_constructorRejectsMissingImmutablePolicy() external {
        vm.expectRevert(CoreV1.ZeroConstitutionId.selector);
        new CoreV1(bytes32(0), CoreTestFixtures.COLLECTOR);

        vm.expectRevert(CoreV1.ZeroCollector.selector);
        new CoreV1(CoreTestFixtures.CONSTITUTION_ID, address(0));
    }

    function test_registerEngineRevisionUsesExactDescriptorAndLiveCodeHash() external {
        EngineRevisionDescriptorV1 memory descriptor = CoreTestFixtures.engineDescriptor(core, address(engine));
        bytes32 expected = core.deriveEngineRevisionId(descriptor);
        bytes32 actual = core.registerEngineRevision(descriptor);
        assertEq(actual, expected);
        assertEq(core.authenticateEngineRevision(actual), address(engine));

        EngineRevisionDescriptorV1 memory stored = core.engineRevisionDescriptor(actual);
        assertEq(stored.chainId, descriptor.chainId);
        assertEq(stored.engine, descriptor.engine);
        assertEq(stored.runtimeCodeHash, descriptor.runtimeCodeHash);
        assertEq(stored.interfaceProfileId, descriptor.interfaceProfileId);
        assertEq(stored.selectorSetHash, descriptor.selectorSetHash);
        assertEq(stored.codePolicyId, descriptor.codePolicyId);
        assertEq(stored.immutableConfigurationCommitment, descriptor.immutableConfigurationCommitment);
        assertEq(stored.dependencyPolicyCommitment, descriptor.dependencyPolicyCommitment);
        assertEq(stored.capabilityProfileCommitment, descriptor.capabilityProfileCommitment);

        assertEq(core.registerEngineRevision(descriptor), actual, "idempotent registration changed identity");
    }

    function test_permissionlessMarketHasNoSeparateRevisionIdentity() external {
        EngineRevisionDescriptorV1 memory engineDescriptor = CoreTestFixtures.engineDescriptor(core, address(engine));
        bytes32 engineRevisionId = core.registerEngineRevision(engineDescriptor);
        MarketDescriptorV1 memory descriptor = CoreTestFixtures.marketDescriptor(engineRevisionId);

        address permissionlessCreator = makeAddr("permissionless market creator");
        vm.prank(permissionlessCreator);
        bytes32 marketId = core.createMarket(descriptor);
        assertEq(marketId, core.deriveMarketId(descriptor));

        MarketDescriptorV1 memory stored = core.marketDescriptor(marketId);
        assertEq(stored.engineRevisionId, engineRevisionId);
        assertEq(stored.immutableParametersCommitment, descriptor.immutableParametersCommitment);

        descriptor.immutableParametersCommitment = keccak256("market.parameters.v2");
        bytes32 changedMarketId = core.createMarket(descriptor);
        assertNotEq(changedMarketId, marketId, "authority-relevant change reused Market ID");
    }

    function test_domainRevisionAndVaultAreTupleDeterministicAndPhysicallyDistinct() external {
        DomainRevisionDescriptorV1 memory descriptor = CoreTestFixtures.domainDescriptor(keccak256("domain.alpha"));
        bytes32 domainRevisionId = core.createDomainRevision(descriptor);
        assertEq(domainRevisionId, core.deriveDomainRevisionId(descriptor));

        bytes32 nativeProfile = core.NATIVE_ETH_ASSET_PROFILE_ID();
        address predicted = core.expectedDomainVault(domainRevisionId, nativeProfile, address(0));
        address vault = core.createDomainVault(domainRevisionId, nativeProfile, address(0));
        assertEq(vault, predicted);
        assertEq(core.createDomainVault(domainRevisionId, nativeProfile, address(0)), vault);

        DomainVaultV1 typedVault = DomainVaultV1(payable(vault));
        assertEq(typedVault.CORE(), address(core));
        assertEq(typedVault.CORE_DEPLOYMENT_ID(), core.CORE_DEPLOYMENT_ID());
        assertEq(typedVault.DOMAIN_REVISION_ID(), domainRevisionId);
        assertEq(typedVault.ASSET_PROFILE_ID(), nativeProfile);
        assertEq(typedVault.NATIVE_ASSET(), address(0));
        assertEq(core.domainVault(domainRevisionId, nativeProfile, address(0)), vault);

        descriptor.domainId = keccak256("domain.beta");
        bytes32 otherRevision = core.createDomainRevision(descriptor);
        address otherVault = core.createDomainVault(otherRevision, nativeProfile, address(0));
        assertNotEq(otherVault, vault, "cross-Domain vault alias");
    }

    /// Threat: actor=unwarned funder; authority=own ETH; pre=canonical foundation vault exists;
    /// attempt=fund then use the only Core execution entry; expect=funding succeeds and execution hard-reverts;
    /// protected post-state=value remains trapped, making the deployment-facing DO-NOT-FUND boundary executable.
    function test_foundationsOnlyCoreCannotReleaseFundsReceivedByCanonicalVault() external {
        DomainRevisionDescriptorV1 memory descriptor =
            CoreTestFixtures.domainDescriptor(keccak256("domain.sink-warning"));
        bytes32 domainRevisionId = core.createDomainRevision(descriptor);
        address vault = core.createDomainVault(domainRevisionId, core.NATIVE_ETH_ASSET_PROFILE_ID(), address(0));

        vm.deal(address(this), 1 ether);
        (bool funded,) = vault.call{ value: 1 ether }("");
        assertTrue(funded, "native foundation vault did not receive the warning-case donation");

        vm.expectRevert(
            abi.encodeWithSelector(CoreV1.BlockedBySpec.selector, core.DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR())
        );
        core.executeProtected(bytes("fund-release-attempt"));

        assertEq(vault.balance, 1 ether, "blocked Core unexpectedly released canonical vault funds");
        assertEq(address(core).balance, 0, "blocked Core received canonical vault funds");
    }

    /// Threat: actor=chain operator; authority=runtime chain configuration; pre=Core identity is deployment-chain
    /// bound; attempt=mutate descriptors or custody after chain-ID drift; expect=all mutation entries fail closed;
    /// protected post-state=no descriptor, vault, value, or event is committed under a mixed-chain identity.
    function test_allMutationEntriesRejectDeploymentChainIdDriftWithoutCommit() external {
        EngineRevisionDescriptorV1 memory knownEngineDescriptor =
            CoreTestFixtures.engineDescriptor(core, address(engine));
        bytes32 knownEngineRevisionId = core.registerEngineRevision(knownEngineDescriptor);

        OpaqueStateEngineV1 unregisteredEngine = new OpaqueStateEngineV1();
        EngineRevisionDescriptorV1 memory unregisteredEngineDescriptor =
            CoreTestFixtures.engineDescriptor(core, address(unregisteredEngine));
        bytes32 unregisteredEngineRevisionId = core.deriveEngineRevisionId(unregisteredEngineDescriptor);

        MarketDescriptorV1 memory market = CoreTestFixtures.marketDescriptor(knownEngineRevisionId);
        bytes32 marketId = core.deriveMarketId(market);

        DomainRevisionDescriptorV1 memory existingDomain =
            CoreTestFixtures.domainDescriptor(keccak256("domain.pre-drift"));
        bytes32 existingDomainRevisionId = core.createDomainRevision(existingDomain);
        DomainRevisionDescriptorV1 memory unregisteredDomain =
            CoreTestFixtures.domainDescriptor(keccak256("domain.during-drift"));
        bytes32 unregisteredDomainRevisionId = core.deriveDomainRevisionId(unregisteredDomain);
        bytes32 nativeProfile = core.NATIVE_ETH_ASSET_PROFILE_ID();

        uint256 deploymentChainId = core.DEPLOYMENT_CHAIN_ID();
        uint256 driftedChainId = deploymentChainId + 1;
        vm.chainId(driftedChainId);
        vm.recordLogs();

        bytes memory mismatch =
            abi.encodeWithSelector(CoreV1.DeploymentChainIdMismatch.selector, deploymentChainId, driftedChainId);
        vm.expectRevert(mismatch);
        core.registerEngineRevision(unregisteredEngineDescriptor);
        vm.expectRevert(mismatch);
        core.createMarket(market);
        vm.expectRevert(mismatch);
        core.createDomainRevision(unregisteredDomain);
        vm.expectRevert(mismatch);
        core.createDomainVault(existingDomainRevisionId, nativeProfile, address(0));
        vm.expectRevert(mismatch);
        core.executeProtected(hex"00");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0, "chain-ID drift emitted a committed mutation event");

        vm.chainId(deploymentChainId);
        vm.expectRevert(abi.encodeWithSelector(CoreV1.UnknownEngineRevision.selector, unregisteredEngineRevisionId));
        core.engineRevisionDescriptor(unregisteredEngineRevisionId);
        vm.expectRevert(abi.encodeWithSelector(CoreV1.UnknownMarket.selector, marketId));
        core.marketDescriptor(marketId);
        vm.expectRevert(abi.encodeWithSelector(CoreV1.UnknownDomainRevision.selector, unregisteredDomainRevisionId));
        core.domainRevisionDescriptor(unregisteredDomainRevisionId);
        assertEq(core.domainVault(existingDomainRevisionId, nativeProfile, address(0)), address(0));
        assertEq(address(core).balance, 0, "chain-ID drift retained native value");
    }

    /// Threat: actor=router; authority=opaque bytes/value; pre=no grammar/zero balance; attempt=execute;
    /// expect=blocked; post=zero/no commit.
    function test_protectedExecutionAlwaysRevertsWithAggregateLocalIssue() external {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(CoreV1.BlockedBySpec.selector, core.DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR())
        );
        core.executeProtected{ value: 1 ether }(hex"deadbeef");
        assertEq(address(core).balance, 0, "blocked execution retained value");
    }

    function test_knownBlockedIssueIdentifiersAreStableAndDistinct() external view {
        uint256 count = core.KNOWN_BLOCKED_SPEC_ISSUE_COUNT();
        assertEq(count, 12);
        bytes32[12] memory expected = [
            core.DEX_EVM_SPEC_REFUND_GRAMMAR(),
            core.DEX_EVM_SPEC_CAPABILITY_COMMITMENTS(),
            core.DEX_EVM_SPEC_STORED_SCOPE_MINIMUM_CREDITS(),
            core.DEX_EVM_SPEC_EFFECT_OCCURRENCE_ID(),
            core.DEX_EVM_SPEC_ASSET_SOURCE_DESTINATION_CLASSES(),
            core.DEX_EVM_SPEC_ASYNC_DEFICIT_OBSERVABILITY(),
            core.DEX_EVM_SPEC_RECEIPT_TARGET_DOMAIN_MAPPING(),
            core.DEX_EVM_SPEC_IDENTIFIER_PROFILE_METADATA(),
            core.DEX_EVM_SPEC_EXIT_PROFILE_VECTORS(),
            core.DEX_EVM_SPEC_PRINCIPAL_SOURCE_BINDING(),
            core.DEX_EVM_SPEC_SCOPE_EIP712_BRIDGE(),
            core.DEX_EVM_SPEC_RETURN_ONLY_PROPOSAL_TRANSCRIPT()
        ];
        for (uint256 i; i < count; ++i) {
            bytes32 issue = core.blockedSpecIssueId(i);
            assertNotEq(issue, bytes32(0));
            assertEq(issue, expected[i], "blocker index-to-gap mapping drift");
            for (uint256 j; j < i; ++j) {
                assertNotEq(issue, core.blockedSpecIssueId(j));
            }
        }
    }

    function test_unknownEvidenceReadsFailClosed() external {
        bytes32 unknown = keccak256("unknown");
        vm.expectRevert(abi.encodeWithSelector(CoreV1.UnknownEngineRevision.selector, unknown));
        core.engineRevisionDescriptor(unknown);
        vm.expectRevert(abi.encodeWithSelector(CoreV1.UnknownMarket.selector, unknown));
        core.marketDescriptor(unknown);
        vm.expectRevert(abi.encodeWithSelector(CoreV1.UnknownDomainRevision.selector, unknown));
        core.domainRevisionDescriptor(unknown);
    }
}
