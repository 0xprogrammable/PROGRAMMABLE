// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { ShardHookV1 } from "shards-v1/src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "shards-v1/src/ShardLaunchFactoryV1.sol";

import { ProgrammableExactShardsProfileV1 } from "programmable-src/ProgrammableExactShardsProfileV1.sol";
import {
    IProgrammableNestedFactoryProfileV1,
    IProgrammableNestedFactoryProviderV1,
    IProgrammableNestedFactoryPostconditionVerifierV1
} from "programmable-src/router_vnext/IProgrammableNestedFactoryProfileV1.sol";
import {
    IProgrammableUniversalLaunchKernelV1
} from "programmable-src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol";
import {
    IProgrammableShardsHookCodeStoreV1,
    ProgrammableExactShardsNestedFactoryProviderV1,
    ProgrammableExactShardsNestedFactoryVerifierV1
} from "../src/ProgrammableExactShardsNestedFactoryV1.sol";
import { ProgrammableShardsHookCodeStoreV1 } from "../src/ProgrammableShardsHookCodeStoreV1.sol";

contract ExactShardsKernelHarnessV1 {
    IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 private _descriptor;
    IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 private _grant;
    bytes32 private _activeGrantDigest;

    function bind(
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 calldata descriptor,
        bytes32 grantDigest,
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 calldata grant
    ) external {
        _descriptor = descriptor;
        _activeGrantDigest = grantDigest;
        _grant = grant;
    }

    function profileDescriptorV1(bytes32)
        external
        view
        returns (IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory)
    {
        return _descriptor;
    }

    function launchGrantV1(bytes32) external view returns (IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory) {
        return _grant;
    }

    function activeExecutionGrantDigestV1() external view returns (bytes32) {
        return _activeGrantDigest;
    }
}

contract ExactShardsProfileHarnessV1 {
    IProgrammableUniversalLaunchKernelV1 public immutable KERNEL;
    address public immutable PROVIDER;
    address public immutable POSTCONDITION_VERIFIER;
    bytes32 public immutable PROFILE_KEY;
    bytes32 public immutable PROVIDER_BINDING_HASH;
    bytes32 public immutable VERIFIER_BINDING_HASH;

    constructor(
        IProgrammableUniversalLaunchKernelV1 kernel,
        address provider,
        address verifier,
        bytes32 profileKey,
        bytes32 providerBindingHash,
        bytes32 verifierBindingHash
    ) {
        KERNEL = kernel;
        PROVIDER = provider;
        POSTCONDITION_VERIFIER = verifier;
        PROFILE_KEY = profileKey;
        PROVIDER_BINDING_HASH = providerBindingHash;
        VERIFIER_BINDING_HASH = verifierBindingHash;
    }

    function computeNestedFactoryPlanHashV1(IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(plan));
    }

    function preflight(IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan)
        external
        view
        returns (bytes32)
    {
        return IProgrammableNestedFactoryPostconditionVerifierV1(POSTCONDITION_VERIFIER)
            .verifyNestedPreflightV1(address(this), plan);
    }

    function execute(
        bytes32 executionKey,
        bytes32 grantDigest,
        bytes32 stampLaunchId,
        bytes32 antiReplayNonce,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan
    ) external returns (IProgrammableNestedFactoryProfileV1.NestedFactoryResultV1 memory) {
        return IProgrammableNestedFactoryProviderV1(PROVIDER)
            .executeNestedFactoryV1(
                executionKey, grantDigest, stampLaunchId, antiReplayNonce, plan.action, plan.components
            );
    }

    function postflight(
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan,
        IProgrammableNestedFactoryProfileV1.NestedFactoryResultV1 calldata result
    ) external view returns (IProgrammableNestedFactoryProfileV1.NestedPostconditionResultV1 memory) {
        return IProgrammableNestedFactoryPostconditionVerifierV1(POSTCONDITION_VERIFIER)
            .verifyNestedPostconditionsV1(address(this), plan, result);
    }
}

contract ProgrammableExactShardsNestedFactoryForkTest is Test {
    uint256 private constant SNAPSHOT_BLOCK = 25_724_010;
    address private constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 private constant POOL_MANAGER_RUNTIME_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 private constant PROFILE_KEY = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    bytes32 private constant PROVIDER_PLAN_ID = keccak256("PROGRAMMABLE_EXACT_SHARDS_UNIVERSAL_PLAN_V1");
    bytes32 private constant SOURCE_LAUNCH_ID = keccak256("JESSE_STAHL_SHARDS_V1_91B38F3_MAINNET_LAUNCH_V1");
    address private constant LAUNCH_WALLET = 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;
    address private constant TOKEN_OWNERLESS_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_TOKEN_OWNERLESS_V1"))));
    address private constant HOOK_CONTROL_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_HOOK_BUILDER_ROLE_ONLY_V1"))));
    address private constant SPLIT_REVENUE_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_HOLDER_BUILDER_LAUNCHER_SPLIT_V1"))));
    uint256 private constant SEED_AMOUNT = 10_000 ether;
    bytes32 private constant CONFIGURATION_HASH = 0xa98b7b95777267181a2b93a33632991e80a49f4a57d94150f8dfbd90421f34c1;
    bytes32 private constant POOL_ID = 0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d;
    bytes32 private constant REVENUE_POLICY_HASH = 0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2;
    address private constant PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 private constant FACTORY_SALT = 0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d;
    address private constant FACTORY = 0x9442a520e7b31D10177C75A363355C2C29141ac5;
    address private constant RENDERER = 0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14;
    address private constant TOKEN = 0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF;
    address private constant HOOK = 0xbA318baA8649962fD77CC7082d098f2C09Fd60cC;
    address private constant NFT = 0x9fDA98dE1B7061ae02A9Aec7A6f8ed75a8Feb8F3;
    bytes32 private constant GRANT_DIGEST = keccak256("exact-shards-universal-grant");
    bytes32 private constant EXECUTION_KEY = keccak256("exact-shards-universal-execution");
    bytes32 private constant STAMP_LAUNCH_ID = keccak256("exact-shards-universal-stamp");
    bytes32 private constant ANTI_REPLAY_NONCE = keccak256("exact-shards-universal-nonce");
    uint256 private constant PROVIDER_GAS_CEILING = 12_000_000;
    uint256 private constant MAINNET_TRANSACTION_GAS_LIMIT = 16_777_216;

    ExactShardsKernelHarnessV1 private kernel;
    ProgrammableExactShardsNestedFactoryProviderV1 private provider;
    ProgrammableExactShardsNestedFactoryVerifierV1 private verifier;
    ExactShardsProfileHarnessV1 private profile;

    function setUp() external {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        assertEq(block.chainid, 1);
        assertEq(FACTORY.code.length, 0);
        assertEq(RENDERER.code.length, 0);
        assertEq(TOKEN.code.length, 0);
        assertEq(HOOK.code.length, 0);
        assertEq(NFT.code.length, 0);

        _deployFactory();
        kernel = new ExactShardsKernelHarnessV1();
        ProgrammableExactShardsProfileV1 exactValidator = new ProgrammableExactShardsProfileV1();
        ProgrammableShardsHookCodeStoreV1 store = new ProgrammableShardsHookCodeStoreV1();
        bytes32 storeBinding = store.runtimeBindingHashV1();
        provider = new ProgrammableExactShardsNestedFactoryProviderV1(
            IProgrammableUniversalLaunchKernelV1(address(kernel)),
            address(kernel).codehash,
            exactValidator,
            address(exactValidator).codehash,
            IProgrammableShardsHookCodeStoreV1(address(store)),
            address(store).codehash,
            storeBinding
        );
        verifier = new ProgrammableExactShardsNestedFactoryVerifierV1(
            IProgrammableUniversalLaunchKernelV1(address(kernel)),
            address(kernel).codehash,
            exactValidator,
            address(exactValidator).codehash,
            IProgrammableShardsHookCodeStoreV1(address(store)),
            address(store).codehash,
            storeBinding
        );
        profile = new ExactShardsProfileHarnessV1(
            IProgrammableUniversalLaunchKernelV1(address(kernel)),
            address(provider),
            address(verifier),
            PROFILE_KEY,
            provider.runtimeBindingHashV1(),
            verifier.runtimeBindingHashV1()
        );
    }

    function testExactExecuteOnlyProviderVerifierForkPath() external {
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan = _plan();
        _bind(plan);
        uint256 preflightGasBefore = gasleft();
        bytes32 preflightHash = profile.preflight(plan);
        emit log_named_uint("exact Shards verifier preflight gas", preflightGasBefore - gasleft());
        assertTrue(preflightHash != bytes32(0));

        uint256 gasBefore = gasleft();
        IProgrammableNestedFactoryProfileV1.NestedFactoryResultV1 memory result =
            profile.execute(EXECUTION_KEY, GRANT_DIGEST, STAMP_LAUNCH_ID, ANTI_REPLAY_NONCE, plan);
        uint256 providerGas = gasBefore - gasleft();
        emit log_named_uint("exact Shards provider gas", providerGas);
        assertLt(providerGas, PROVIDER_GAS_CEILING);
        assertLt(providerGas, MAINNET_TRANSACTION_GAS_LIMIT);
        assertEq(result.configurationHash, plan.action.configurationHash);
        assertEq(result.componentSetHash, plan.componentSetHash);
        assertEq(result.componentRuntimeSetHash, plan.componentRuntimeSetHash);
        assertEq(result.architectureStateHash, plan.expectedArchitectureStateHash);
        assertEq(result.poolStateHash, plan.expectedPoolStateHash);
        assertEq(result.supplyValueFlowHash, plan.expectedValueFlowHash);
        assertEq(result.returnedIdentitiesHash, plan.expectedReturnedIdentitiesHash);

        uint256 postflightGasBefore = gasleft();
        IProgrammableNestedFactoryProfileV1.NestedPostconditionResultV1 memory post = profile.postflight(plan, result);
        emit log_named_uint("exact Shards verifier postflight gas", postflightGasBefore - gasleft());
        assertEq(post.architectureStateHash, plan.expectedArchitectureStateHash);
        assertEq(post.poolStateHash, plan.expectedPoolStateHash);
        assertEq(post.revenueStateHash, plan.expectedRevenueStateHash);
        assertEq(post.valueFlowHash, plan.expectedValueFlowHash);

        vm.expectRevert();
        profile.preflight(plan);
    }

    function _plan() private view returns (IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan) {
        plan.schemaVersion = 1;
        plan.action.providerPlanId = PROVIDER_PLAN_ID;
        plan.action.factorySalt = FACTORY_SALT;
        plan.action.applicantWallet = LAUNCH_WALLET;
        plan.action.sourceLaunchId = SOURCE_LAUNCH_ID;
        plan.action.poolManager = POOL_MANAGER;
        plan.action.poolManagerRuntimeCodeHash = POOL_MANAGER_RUNTIME_CODE_HASH;
        plan.action.poolId = POOL_ID;
        plan.action.tokenOwner = TOKEN_OWNERLESS_SENTINEL;
        plan.action.hookOwner = HOOK_CONTROL_SENTINEL;
        plan.action.treasury = SPLIT_REVENUE_SENTINEL;
        plan.action.tokenSupply = SEED_AMOUNT;
        plan.action.nativeValue = 0;
        plan.action.hookPermissionsHash = provider.hookPermissionsHashV1();
        plan.action.configurationHash = CONFIGURATION_HASH;
        plan.components = provider.expectedComponentsV1();
        plan.componentGraphHash = provider.componentGraphHashV1();
        (
            plan.componentSetHash,
            plan.componentRuntimeSetHash,
            plan.expectedArchitectureStateHash,
            plan.expectedPoolStateHash,
            plan.expectedRevenueStateHash,
            plan.expectedValueFlowHash,
            plan.expectedReturnedIdentitiesHash
        ) = provider.expectedStateHashesV1();
    }

    function _bind(IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan) private {
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor;
        descriptor.profileKey = PROFILE_KEY;
        descriptor.schemaId = keccak256("NESTED_FACTORY_SCHEMA_V1");
        descriptor.profileVersion = 1;
        descriptor.capabilitySemantics = IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute;
        descriptor.module = address(profile);
        descriptor.moduleRuntimeCodeHash = address(profile).codehash;
        descriptor.actionTypeHash = keccak256(
            "NestedFactoryPlanV1(uint16 schemaVersion,bytes32 actionHash,bytes32 orderedComponentHeadHash,bytes32 componentGraphHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,bytes32 expectedStateHash)"
        );
        descriptor.exactContractBindingHash = provider.runtimeBindingHashV1();
        descriptor.providerBindingHash = provider.runtimeBindingHashV1();
        descriptor.revenuePolicyHash = REVENUE_POLICY_HASH;
        descriptor.status = IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active;

        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant;
        grant.profileKey = PROFILE_KEY;
        grant.sourceLaunchId = SOURCE_LAUNCH_ID;
        grant.stampLaunchId = STAMP_LAUNCH_ID;
        grant.antiReplayNonce = ANTI_REPLAY_NONCE;
        grant.componentGraphHash = plan.componentGraphHash;
        grant.componentRuntimeSetHash = plan.componentRuntimeSetHash;
        grant.configurationHash = plan.action.configurationHash;
        grant.providerBindingHash = provider.runtimeBindingHashV1();
        kernel.bind(descriptor, GRANT_DIGEST, grant);
    }

    function _deployFactory() private {
        bytes memory initCode = bytes.concat(
            type(ShardLaunchFactoryV1).creationCode,
            abi.encode(IPoolManager(POOL_MANAGER), keccak256(type(ShardHookV1).creationCode))
        );
        bytes memory proxyCalldata = bytes.concat(FACTORY_SALT, initCode);
        (bool success, bytes memory result) = PROXY.call(proxyCalldata);
        assertTrue(success);
        assertEq(result.length, 20);
        assertEq(FACTORY.codehash, providerFactoryRuntimeHash());
        assertTrue(RENDERER.code.length != 0);
    }

    function providerFactoryRuntimeHash() private pure returns (bytes32) {
        return 0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5;
    }
}
