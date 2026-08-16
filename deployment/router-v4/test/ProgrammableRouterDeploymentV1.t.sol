// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import {
    IProgrammableUniversalLaunchKernelV1
} from "programmable-src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol";
import {
    ProgrammableUniversalLaunchPreflightV1
} from "programmable-src/router_vnext/ProgrammableUniversalLaunchPreflightV1.sol";
import {
    IProgrammableNestedFactoryProfileV1
} from "programmable-src/router_vnext/IProgrammableNestedFactoryProfileV1.sol";
import {
    IProgrammableCompletedGraphAdoptionCompatV1
} from "programmable-src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol";
import { ProgrammableExactShardsProfileV1 } from "programmable-src/ProgrammableExactShardsProfileV1.sol";
import {
    ProgrammableRouterReviewerAuthorityV4,
    ProgrammableRouterGovernanceAuthorityV4,
    ProgrammableRouterFinalityAuthorityV4,
    ProgrammableRouterIndexerAuthorityV4
} from "../src/ProgrammableRouterAuthorityV4.sol";
import { ProgrammableShardsHookCodeStoreV1 } from "../src/ProgrammableShardsHookCodeStoreV1.sol";
import {
    IProgrammableShardsHookCodeStoreV1,
    ProgrammableExactShardsNestedFactoryProviderV1,
    ProgrammableExactShardsNestedFactoryVerifierV1
} from "../src/ProgrammableExactShardsNestedFactoryV1.sol";

contract RouterDeploymentMockUniversalKernelV1 {
    IProgrammableUniversalLaunchKernelV1.ControlStateV1 private _control;
    IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 private _descriptor;
    uint256 public sequence;
    uint256 public advancedAt;
    uint256 public registeredAt;
    bool public globalKilled;

    constructor() {
        _control = IProgrammableUniversalLaunchKernelV1.ControlStateV1({
            securityControlHeadHash: keccak256("c0-control"),
            securityEpoch: 1,
            securityEpochHash: keccak256("c0-security"),
            policyEpoch: 1,
            policyEpochHash: keccak256("c0-policy"),
            reviewGeneration: 1,
            reviewGenerationHash: keccak256("c0-review"),
            globalKilled: true
        });
        globalKilled = true;
    }

    function controlStateV1() external view returns (IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory) {
        return _control;
    }

    function profileDescriptorV1(bytes32)
        external
        view
        returns (IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory)
    {
        return _descriptor;
    }

    function advanceControlV1(IProgrammableUniversalLaunchKernelV1.ControlStateV1 calldata next) external {
        require(_control.globalKilled && !next.globalKilled, "unsafe order");
        require(
            next.securityEpoch > _control.securityEpoch && next.policyEpoch > _control.policyEpoch
                && next.reviewGeneration > _control.reviewGeneration,
            "stale control"
        );
        _control = next;
        globalKilled = next.globalKilled;
        advancedAt = ++sequence;
    }

    function registerProfileV1(IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 calldata descriptor) external {
        require(!_control.globalKilled, "still killed");
        require(descriptor.securityEpoch == _control.securityEpoch, "stale profile");
        _descriptor = descriptor;
        registeredAt = ++sequence;
    }

    function setGlobalKillV1(bool killed) external {
        require(killed, "clear forbidden");
        _control.globalKilled = true;
        globalKilled = true;
    }

    function setProfileStatusV1(bytes32, IProgrammableUniversalLaunchKernelV1.ProfileStatus) external { }

    function revokeLaunchGrantV1(bytes32) external { }

    function revokeExecutionCurrentnessV1(bytes32) external { }
}

contract RouterDeploymentMockHookemonRegistryV1 {
    bool public globalKilled;
    uint256 public killCalls;
    uint256 public sequence;
    uint256 public advancedAt;
    uint256 public clearedAt;
    uint256 public registeredAt;
    uint64 public reviewGeneration = 1;
    bytes32 public reviewGenerationHash = keccak256("hookemon-review-1");

    function setGlobalAdoptionKillV1(bool killed) external {
        globalKilled = killed;
        killCalls += 1;
        if (!killed) clearedAt = ++sequence;
    }

    function advanceSecurityPolicyEpochsV1(
        bytes32,
        uint64 securityEpoch,
        bytes32,
        uint64 policyEpoch,
        bytes32,
        uint64 nextReviewGeneration,
        bytes32 nextReviewGenerationHash
    ) external {
        require(globalKilled, "must remain killed while controls advance");
        require(securityEpoch > 1 && policyEpoch > 1 && nextReviewGeneration > reviewGeneration, "stale control");
        reviewGeneration = nextReviewGeneration;
        reviewGenerationHash = nextReviewGenerationHash;
        advancedAt = ++sequence;
    }

    function registerAdoptionProfileV1(
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability
    ) external {
        require(!globalKilled, "profile registered before clear");
        require(
            capability.reviewControl.reviewGeneration == reviewGeneration
                && capability.reviewControl.reviewGenerationHash == reviewGenerationHash,
            "stale profile"
        );
        registeredAt = ++sequence;
    }

    fallback() external { }
}

contract RouterDeploymentCodeOnlyV1 { }

contract ProgrammableRouterDeploymentV1Test is Test {
    uint256 private constant CONTROLLER_KEY = 0xA11CE;
    address private constant TOKEN_OWNERLESS_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_TOKEN_OWNERLESS_V1"))));
    address private constant HOOK_CONTROL_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_HOOK_BUILDER_ROLE_ONLY_V1"))));
    address private constant SPLIT_REVENUE_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_HOLDER_BUILDER_LAUNCHER_SPLIT_V1"))));
    address private controller;
    RouterDeploymentMockUniversalKernelV1 private universal;
    RouterDeploymentMockHookemonRegistryV1 private hookemon;

    function setUp() external {
        controller = vm.addr(CONTROLLER_KEY);
        universal = new RouterDeploymentMockUniversalKernelV1();
        hookemon = new RouterDeploymentMockHookemonRegistryV1();
    }

    function testAuthorityV4PurposeConsumerGenerationAndGasAreClosed() external {
        ProgrammableRouterReviewerAuthorityV4 reviewer = new ProgrammableRouterReviewerAuthorityV4(
            controller, bytes32(0), address(this), 1, keccak256("service-release-1")
        );
        reviewer.initializeConsumersV1(
            address(universal), address(universal).codehash, address(hookemon), address(hookemon).codehash
        );
        assertTrue(hookemon.globalKilled());
        assertEq(hookemon.killCalls(), 1);

        bytes32 digest = keccak256("universal-currentness");
        uint8 purpose = reviewer.PURPOSE_UNIVERSAL_CURRENTNESS();
        bytes memory signature = _authoritySignature(reviewer, digest, purpose, address(universal));

        vm.prank(address(universal));
        uint256 gasBefore = gasleft();
        bytes4 magic = reviewer.isValidSignature(digest, signature);
        uint256 gasUsed = gasBefore - gasleft();
        assertEq(magic, IERC1271.isValidSignature.selector);
        assertLt(gasUsed, 100_000);

        vm.prank(address(hookemon));
        assertEq(reviewer.isValidSignature(digest, signature), bytes4(0xffffffff));
        bytes memory wrongPurpose =
            _authoritySignature(reviewer, digest, reviewer.PURPOSE_HOOKEMON_CURRENTNESS(), address(universal));
        vm.prank(address(universal));
        assertEq(reviewer.isValidSignature(digest, wrongPurpose), bytes4(0xffffffff));

        vm.prank(controller);
        reviewer.rotateAuthorityBindingV1(2, keccak256("service-release-2"));
        vm.prank(address(universal));
        assertEq(reviewer.isValidSignature(digest, signature), bytes4(0xffffffff));

        vm.prank(controller);
        reviewer.killAuthorityV1();
        vm.prank(controller);
        (bool clearSurface,) = address(reviewer).call(abi.encodeWithSignature("hookemonSetGlobalKillV1(bool)", false));
        assertFalse(clearSurface);
    }

    function testAuthorityV4RolesArePairwiseDistinctAndGovernanceActivatesProfileLast() external {
        bytes32 releaseBinding = keccak256("service-release-1");
        ProgrammableRouterReviewerAuthorityV4 reviewer =
            new ProgrammableRouterReviewerAuthorityV4(controller, bytes32(0), address(this), 1, releaseBinding);
        ProgrammableRouterGovernanceAuthorityV4 governance =
            new ProgrammableRouterGovernanceAuthorityV4(controller, bytes32(0), address(this), 1, releaseBinding);
        ProgrammableRouterFinalityAuthorityV4 finality =
            new ProgrammableRouterFinalityAuthorityV4(controller, bytes32(0), address(this), 1, releaseBinding);
        ProgrammableRouterIndexerAuthorityV4 indexer =
            new ProgrammableRouterIndexerAuthorityV4(controller, bytes32(0), address(this), 1, releaseBinding);
        reviewer.initializeConsumersV1(
            address(universal), address(universal).codehash, address(hookemon), address(hookemon).codehash
        );
        governance.initializeConsumersV1(
            address(universal), address(universal).codehash, address(hookemon), address(hookemon).codehash
        );
        finality.initializeConsumersV1(
            address(universal), address(universal).codehash, address(hookemon), address(hookemon).codehash
        );
        indexer.initializeConsumersV1(
            address(universal), address(universal).codehash, address(hookemon), address(hookemon).codehash
        );

        assertTrue(address(reviewer) != address(governance));
        assertTrue(address(reviewer).codehash != address(governance).codehash);
        assertTrue(address(finality).codehash != address(indexer).codehash);
        assertTrue(reviewer.runtimeBindingHashV1() != governance.runtimeBindingHashV1());

        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory next =
            IProgrammableUniversalLaunchKernelV1.ControlStateV1({
                securityControlHeadHash: keccak256("c1-control"),
                securityEpoch: 2,
                securityEpochHash: keccak256("c1-security"),
                policyEpoch: 2,
                policyEpochHash: keccak256("c1-policy"),
                reviewGeneration: 2,
                reviewGenerationHash: keccak256("c1-review"),
                globalKilled: false
            });
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor;
        descriptor.profileKey = keccak256("profile");
        descriptor.schemaId = keccak256("schema");
        descriptor.profileVersion = 1;
        descriptor.capabilitySemantics = IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute;
        descriptor.module = address(0x1234);
        descriptor.moduleRuntimeCodeHash = keccak256("module");
        descriptor.actionTypeHash = keccak256("action");
        descriptor.exactContractBindingHash = keccak256("contract-binding");
        descriptor.providerBindingHash = keccak256("provider-binding");
        descriptor.revenuePolicyHash = keccak256("revenue");
        descriptor.securityControlHeadHash = next.securityControlHeadHash;
        descriptor.securityEpoch = next.securityEpoch;
        descriptor.securityEpochHash = next.securityEpochHash;
        descriptor.policyEpoch = next.policyEpoch;
        descriptor.policyEpochHash = next.policyEpochHash;
        descriptor.reviewGeneration = next.reviewGeneration;
        descriptor.reviewGenerationHash = next.reviewGenerationHash;
        descriptor.status = IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active;

        vm.prank(controller);
        governance.activateUniversalProfileV1(next, descriptor);
        assertEq(universal.advancedAt(), 1);
        assertEq(universal.registeredAt(), 2);
        assertFalse(universal.globalKilled());

        bytes32 hookemonReviewHash = keccak256("hookemon-review-2");
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability;
        capability.reviewControl = IProgrammableCompletedGraphAdoptionCompatV1.ReviewGenerationV1({
            reviewGenerationHash: hookemonReviewHash, reviewGeneration: 2
        });
        vm.prank(controller);
        governance.activateHookemonProfileV1(
            capability,
            keccak256("hookemon-control-2"),
            2,
            keccak256("hookemon-security-2"),
            2,
            keccak256("hookemon-policy-2"),
            2,
            hookemonReviewHash
        );
        assertTrue(hookemon.advancedAt() < hookemon.clearedAt());
        assertTrue(hookemon.clearedAt() < hookemon.registeredAt());
        assertFalse(hookemon.globalKilled());
    }

    function testShardsCodeStoreReassemblesExactCreationCodeAndRejectsRuntimeDrift() external {
        ProgrammableShardsHookCodeStoreV1 store = new ProgrammableShardsHookCodeStoreV1();
        bytes memory creationCode = store.readHookCreationCodeV1();
        assertEq(creationCode.length, store.HOOK_CREATION_CODE_LENGTH());
        assertEq(keccak256(creationCode), store.HOOK_CREATION_CODE_HASH());
        assertEq(store.PART_0().codehash, store.PART_0_RUNTIME_CODE_HASH());
        assertEq(store.PART_1().codehash, store.PART_1_RUNTIME_CODE_HASH());

        vm.etch(store.PART_1(), hex"00");
        vm.expectRevert();
        store.readHookCreationCodeV1();
    }

    function testShardsProviderVerifierBindingsAreDistinctStatelessAndUseExplicitSentinels() external {
        RouterDeploymentCodeOnlyV1 kernel = new RouterDeploymentCodeOnlyV1();
        ProgrammableExactShardsProfileV1 exactValidator = new ProgrammableExactShardsProfileV1();
        ProgrammableShardsHookCodeStoreV1 store = new ProgrammableShardsHookCodeStoreV1();
        bytes32 storeBinding = store.runtimeBindingHashV1();
        ProgrammableExactShardsNestedFactoryProviderV1 provider = new ProgrammableExactShardsNestedFactoryProviderV1(
            IProgrammableUniversalLaunchKernelV1(address(kernel)),
            address(kernel).codehash,
            exactValidator,
            address(exactValidator).codehash,
            IProgrammableShardsHookCodeStoreV1(address(store)),
            address(store).codehash,
            storeBinding
        );
        ProgrammableExactShardsNestedFactoryVerifierV1 verifier = new ProgrammableExactShardsNestedFactoryVerifierV1(
            IProgrammableUniversalLaunchKernelV1(address(kernel)),
            address(kernel).codehash,
            exactValidator,
            address(exactValidator).codehash,
            IProgrammableShardsHookCodeStoreV1(address(store)),
            address(store).codehash,
            storeBinding
        );
        assertTrue(provider.runtimeBindingHashV1() != verifier.runtimeBindingHashV1());
        assertTrue(TOKEN_OWNERLESS_SENTINEL != address(0));
        assertTrue(HOOK_CONTROL_SENTINEL != address(0));
        assertTrue(SPLIT_REVENUE_SENTINEL != address(0));
        assertTrue(TOKEN_OWNERLESS_SENTINEL != HOOK_CONTROL_SENTINEL);

        IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] memory components = provider.expectedComponentsV1();
        assertEq(components.length, 5);
        assertEq(components[0].role, 1);
        assertEq(
            uint8(components[0].scope), uint8(IProgrammableNestedFactoryProfileV1.ComponentScopeV1.ExclusiveCreate)
        );
        assertEq(
            uint8(components[3].scope), uint8(IProgrammableNestedFactoryProfileV1.ComponentScopeV1.SharedInfrastructure)
        );

        ProgrammableUniversalLaunchPreflightV1 preflight = new ProgrammableUniversalLaunchPreflightV1();
        assertTrue(
            preflight.closedRuntimeBindingHashV1(
                address(provider), address(provider).codehash, provider.runtimeBindingHashV1(), true
            ) != bytes32(0)
        );
        assertTrue(
            preflight.closedRuntimeBindingHashV1(
                address(verifier), address(verifier).codehash, verifier.runtimeBindingHashV1(), true
            ) != bytes32(0)
        );
    }

    function _authoritySignature(
        ProgrammableRouterReviewerAuthorityV4 reviewer,
        bytes32 digest,
        uint8 purpose,
        address consumer
    ) private view returns (bytes memory) {
        bytes32 controllerDigest = reviewer.controllerDigestV1(digest, purpose, consumer);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTROLLER_KEY, controllerDigest);
        return bytes.concat(bytes1(purpose), r, s, bytes1(v));
    }
}
