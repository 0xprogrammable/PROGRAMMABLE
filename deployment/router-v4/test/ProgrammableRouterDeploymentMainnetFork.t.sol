// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";

import {
    IProgrammableUniversalLaunchKernelV1
} from "programmable-src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol";
import {
    IProgrammableNestedFactoryProfileV1
} from "programmable-src/router_vnext/IProgrammableNestedFactoryProfileV1.sol";
import {
    IProgrammableCompletedGraphAdoptionCompatV1
} from "programmable-src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol";
import {
    ProgrammableCompletedGraphAdoptionGrantRegistryV1
} from "programmable-src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol";
import {
    ProgrammableCompletedGraphAdoptionCompatCodecV1
} from "programmable-src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol";
import {
    ProgrammableCompletedGraphAdoptionPreflightV1
} from "programmable-src/hookemon/ProgrammableCompletedGraphAdoptionPreflightV1.sol";

import { ProgrammableCreate2GraphDeployerV1 } from "../src/ProgrammableCreate2GraphDeployerV1.sol";
import {
    ProgrammableRouterAuthorityV4Base,
    ProgrammableRouterReviewerAuthorityV4,
    ProgrammableRouterGovernanceAuthorityV4,
    ProgrammableRouterFinalityAuthorityV4,
    ProgrammableRouterIndexerAuthorityV4
} from "../src/ProgrammableRouterAuthorityV4.sol";
import {
    IProgrammableNestedFactoryProfileBindingV1,
    ProgrammableExactShardsNestedFactoryProviderV1,
    ProgrammableExactShardsNestedFactoryVerifierV1
} from "../src/ProgrammableExactShardsNestedFactoryV1.sol";
import {
    ProgrammableCompletedGraphRuntimeStateVerifierV1
} from "../src/ProgrammableCompletedGraphRuntimeStateVerifierV1.sol";

interface ISafeV141 {
    function nonce() external view returns (uint256);

    function getMessageHash(bytes calldata message) external view returns (bytes32);

    function approveHash(bytes32 hashToApprove) external;

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures
    ) external payable returns (bool success);
}

interface IUniversalLaunchPreflightBindingV1 {
    function closedRuntimeBindingHashV1(
        address account,
        bytes32 expectedRuntimeCodeHash,
        bytes32 expectedRuntimeBindingHash,
        bool requireStateless
    ) external view returns (bytes32);

    function atomicPreflightHashV1(
        address kernel,
        bytes32 expectedKernelRuntimeCodeHash,
        bytes32 grantDigest,
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] calldata reservations
    ) external view returns (bytes32);
}

interface IShardsStoreReadbackV1 {
    function PART_0() external view returns (address);

    function PART_1() external view returns (address);
}

contract TestOnlyAlwaysValid1271V1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}

contract TestOnlyCompletedGraphNodeV1 {
    uint256 private immutable _marker;

    constructor(uint256 marker) {
        _marker = marker;
    }
}

contract ProgrammableRouterDeploymentMainnetForkTest is Test {
    uint256 private constant SNAPSHOT_BLOCK = 25_731_328;
    uint256 private constant MAINNET_TRANSACTION_GAS_LIMIT = 16_777_216;
    address private constant NICK_CREATE2_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 private constant NICK_CREATE2_PROXY_RUNTIME_HASH =
        0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;
    address private constant SAFE = 0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b;
    bytes32 private constant SAFE_RUNTIME_HASH = 0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c;
    address private constant LAUNCHER = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    bytes32 private constant ROUTE_NAMESPACE = keccak256("PROGRAMMABLE_ROUTER_V4_MAINNET_ROUTE_V1");
    bytes32 private constant SERVICE_RELEASE_BINDING =
        0x32379de927d9a3ca4052037f3de19388566f0b79b26ea01b90d76f09c76f74b0;
    address private constant EXPECTED_GRAPH_DEPLOYER = 0xaE682102d893a113EA3891B12953DEc9f66e3082;
    address private constant EXPECTED_STORE = 0x08454733f76112d3a1cE135629cCc19615e868b4;
    address private constant EXPECTED_EXACT_VALIDATOR = 0xfeE9dC855228Aa3BB61D3f9E598A516643f9c6D6;
    address private constant EXPECTED_REVIEWER = 0x2eA78549C73Cb4208a5eb129d43ebda1203fd768;
    address private constant EXPECTED_GOVERNANCE = 0x979F9E496AbAB43C1B83286087E30dc3BbaAe9dF;
    address private constant EXPECTED_UNIVERSAL_PREFLIGHT = 0x0bed68Fc3418Eb21FD2C1032C77f87c6aBA566B1;
    address private constant EXPECTED_HOOKEMON_CODEC = 0x157A2B242197Ba62BEcB92892cA7A1F975457747;
    address private constant EXPECTED_HOOKEMON_VALIDATOR = 0x077eA1A1da40925f06f8aD1D62C0551E9021B3FF;
    address private constant EXPECTED_HOOKEMON_PREFLIGHT = 0x84ad8fFE50fc3D7270C76b898411b90d6c88A4C5;
    address private constant EXPECTED_HOOKEMON_STATE_VERIFIER = 0x4FE9c5f08ec659bef00385C7aea5C3750edb97AD;
    address private constant EXPECTED_FINALITY = 0xd8A3b8634cfBddaaB7766Eb54002D82423dF3be1;
    address private constant EXPECTED_INDEXER = 0xa091B2Ae533F6DaAEd13EB05d867d816E57c1a73;
    address private constant EXPECTED_KERNEL = 0x25E9DDEB5de79751dB2156D426893d52C8F14DCF;
    address private constant EXPECTED_REGISTRY = 0x636989978c214d7786d21604d7C225cEbf2240C8;
    address private constant EXPECTED_PROVIDER = 0x03385476770CAe102ef673adF9A4631E84258e58;
    address private constant EXPECTED_VERIFIER = 0xA4867B0d72bCE8C1db040E91454D562239daF923;
    address private constant EXPECTED_PROFILE = 0x6d2D661Ab0e462E8047597Adc5bece4BCA157C4C;
    address private constant EXPECTED_STORE_PART_0 = 0x2c8B3eCFA689ea2dD481B6C49ACF58281D610887;
    address private constant EXPECTED_STORE_PART_1 = 0x2FD959F0EF9B3CcA7daaf8fDB3C63BC55F5c2Ff8;
    bytes32 private constant EXPECTED_HOOKEMON_PROFILE_KEY =
        0x7e84ec6d9fd7bbb64e78bfef347234eb667eae84cae181f56d56cc825470aff3;
    bytes32 private constant GRAPH_DEPLOYER_SALT = keccak256("PROGRAMMABLE_ROUTER_V4_GRAPH_DEPLOYER_V1");
    bytes32 private constant REGISTRY_SALT = keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_REGISTRY_V1");
    bytes32 private constant PROFILE_SALT = keccak256("PROGRAMMABLE_ROUTER_V4_NESTED_PROFILE_V1");
    bytes32 private constant PROFILE_KEY = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    bytes32 private constant REVENUE_POLICY_HASH = 0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2;
    address private constant LAUNCH_WALLET = 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;
    address private constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 private constant POOL_MANAGER_RUNTIME_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 private constant FACTORY_SALT = 0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d;
    address private constant FACTORY = 0x9442a520e7b31D10177C75A363355C2C29141ac5;
    address private constant RENDERER = 0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14;
    address private constant TOKEN = 0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF;
    address private constant HOOK = 0xbA318baA8649962fD77CC7082d098f2C09Fd60cC;
    address private constant NFT = 0x9fDA98dE1B7061ae02A9Aec7A6f8ed75a8Feb8F3;
    bytes32 private constant HOOK_CREATION_CODE_HASH =
        0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716;
    bytes32 private constant PROVIDER_PLAN_ID = keccak256("PROGRAMMABLE_EXACT_SHARDS_UNIVERSAL_PLAN_V1");
    bytes32 private constant SOURCE_LAUNCH_ID = keccak256("JESSE_STAHL_SHARDS_V1_91B38F3_MAINNET_LAUNCH_V1");
    address private constant TOKEN_OWNERLESS_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_TOKEN_OWNERLESS_V1"))));
    address private constant HOOK_CONTROL_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_HOOK_BUILDER_ROLE_ONLY_V1"))));
    address private constant SPLIT_REVENUE_SENTINEL =
        address(uint160(uint256(keccak256("PROGRAMMABLE_EXACT_SHARDS_HOLDER_BUILDER_LAUNCHER_SPLIT_V1"))));
    bytes32 private constant CONFIGURATION_HASH = 0xa98b7b95777267181a2b93a33632991e80a49f4a57d94150f8dfbd90421f34c1;
    bytes32 private constant POOL_ID = 0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d;
    uint256 private constant SEED_AMOUNT = 10_000 ether;

    bytes32 private constant G1_NONCE = keccak256("PROGRAMMABLE_ROUTER_V4_GRAPH_1_FOUNDATIONS_V1");
    bytes32 private constant G2A_NONCE = keccak256("PROGRAMMABLE_ROUTER_V4_GRAPH_2A_PREFLIGHT_ROOTS_V1");
    bytes32 private constant G2B_NONCE = keccak256("PROGRAMMABLE_ROUTER_V4_GRAPH_2B_HOOKEMON_VALIDATORS_V1");
    bytes32 private constant G3A_NONCE = keccak256("PROGRAMMABLE_ROUTER_V4_GRAPH_3A_UNIVERSAL_KERNEL_V1");
    bytes32 private constant G4_NONCE = keccak256("PROGRAMMABLE_ROUTER_V4_GRAPH_4_ADAPTERS_V1");

    bytes32 private constant ID_STORE = keccak256("PROGRAMMABLE_ROUTER_V4_SHARDS_HOOK_CODE_STORE_V1");
    bytes32 private constant ID_EXACT = keccak256("PROGRAMMABLE_ROUTER_V4_EXACT_SHARDS_VALIDATOR_V1");
    bytes32 private constant ID_REVIEWER = keccak256("PROGRAMMABLE_ROUTER_V4_REVIEWER_AUTHORITY_V4");
    bytes32 private constant ID_GOVERNANCE = keccak256("PROGRAMMABLE_ROUTER_V4_GOVERNANCE_AUTHORITY_V4");
    bytes32 private constant ID_UNIVERSAL_PREFLIGHT = keccak256("PROGRAMMABLE_ROUTER_V4_UNIVERSAL_PREFLIGHT_V1");
    bytes32 private constant ID_CODEC = keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_CODEC_V1");
    bytes32 private constant ID_HOOKEMON_VALIDATOR = keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_VALIDATOR_V1");
    bytes32 private constant ID_HOOKEMON_PREFLIGHT = keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_PREFLIGHT_V1");
    bytes32 private constant ID_HOOKEMON_STATE_VERIFIER =
        keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_RUNTIME_STATE_VERIFIER_V1");
    bytes32 private constant ID_FINALITY = keccak256("PROGRAMMABLE_ROUTER_V4_FINALITY_AUTHORITY_V4");
    bytes32 private constant ID_INDEXER = keccak256("PROGRAMMABLE_ROUTER_V4_INDEXER_AUTHORITY_V4");
    bytes32 private constant ID_KERNEL = keccak256("PROGRAMMABLE_ROUTER_V4_UNIVERSAL_KERNEL_V1");
    bytes32 private constant ID_PROVIDER = keccak256("PROGRAMMABLE_ROUTER_V4_SHARDS_PROVIDER_V1");
    bytes32 private constant ID_VERIFIER = keccak256("PROGRAMMABLE_ROUTER_V4_SHARDS_VERIFIER_V1");

    ProgrammableCreate2GraphDeployerV1 private graphDeployer;

    struct ReleaseStack {
        address store;
        address exactValidator;
        address reviewer;
        address governance;
        address universalPreflight;
        address codec;
        address hookemonValidator;
        address hookemonPreflight;
        address hookemonStateVerifier;
        address finality;
        address indexer;
        address kernel;
        address registry;
        address provider;
        address verifier;
        address profile;
        bytes32 hookemonProfileKey;
    }

    struct CompletedGraphCompatControlV1 {
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        uint64 reviewGeneration;
        bytes32 reviewGenerationHash;
    }

    struct CompletedGraphCompatFixtureV1 {
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 capability;
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphAdoptionV1 adoption;
    }

    function setUp() external {
        string memory rpc = vm.envString("ETHEREUM_RPC_URL");
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        assertEq(block.chainid, 1);
        assertEq(NICK_CREATE2_PROXY.codehash, NICK_CREATE2_PROXY_RUNTIME_HASH);
        assertEq(SAFE.codehash, SAFE_RUNTIME_HASH);
        vm.deal(LAUNCHER, 100 ether);
    }

    function testStagedExactDeploymentSafeBindingAndDualProfileActivation() external {
        _deployGraphDeployer();
        ReleaseStack memory stack;
        _deployGraph1(stack);
        _deployGraph2(stack);
        _deployGraph3(stack);
        _bindAuthoritiesThroughLiveSafe(stack);
        _deployGraph4(stack);
        _deployGraph5(stack);
        _deployShardsFactory();
        _assertExpectedReleaseStack(stack);
        _assertPreActivationState(stack);
        _activateUniversalThroughLiveSafe(stack);
        _activateCompletedGraphAdoptionCompatThroughLiveSafe(stack);
        _assertFinalActiveState(stack);
        _logReleaseStack(stack);
        _assertLiveSafeControllerSignaturePath(stack);
        _simulateFullCompletedGraphAdoptionCompat(stack);
        _simulateFullUniversalExecution(stack);
    }

    function _deployGraphDeployer() private {
        bytes memory initCode = _creation("ProgrammableCreate2GraphDeployerV1");
        address predicted = _create2Address(NICK_CREATE2_PROXY, GRAPH_DEPLOYER_SALT, keccak256(initCode));
        assertEq(predicted.code.length, 0);
        bytes memory transactionData = bytes.concat(GRAPH_DEPLOYER_SALT, initCode);
        emit log_named_bytes32("graph deployer init code hash", keccak256(initCode));
        emit log_named_bytes32("graph deployer calldata hash", keccak256(transactionData));
        uint256 intrinsicGas = _intrinsicGas(transactionData);
        uint256 outerExecutionGas = MAINNET_TRANSACTION_GAS_LIMIT - intrinsicGas;
        vm.prank(LAUNCHER);
        (bool success, bytes memory result) = NICK_CREATE2_PROXY.call{ gas: outerExecutionGas }(transactionData);
        uint256 transactionGas = uint256(vm.lastCallGas().gasTotalUsed) + intrinsicGas;
        emit log_named_uint("graph deployer deployment gas", transactionGas);
        assertTrue(success);
        assertEq(result.length, 20);
        assertEq(address(bytes20(result)), predicted);
        graphDeployer = ProgrammableCreate2GraphDeployerV1(predicted);
        assertEq(predicted.codehash, _expectedRuntimeTemplateHash("ProgrammableCreate2GraphDeployerV1"));
    }

    function _deployGraph1(ReleaseStack memory stack) private {
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets = new ProgrammableCreate2GraphDeployerV1.Target[](4);
        targets[0] = _target(ID_STORE, _creation("ProgrammableShardsHookCodeStoreV1"));
        targets[1] = _target(ID_EXACT, _creation("ProgrammableExactShardsProfileV1"));
        targets[2] = _target(
            ID_REVIEWER,
            bytes.concat(
                _creation("ProgrammableRouterReviewerAuthorityV4"),
                abi.encode(SAFE, SAFE_RUNTIME_HASH, SAFE, uint64(1), SERVICE_RELEASE_BINDING)
            )
        );
        targets[3] = _target(
            ID_GOVERNANCE,
            bytes.concat(
                _creation("ProgrammableRouterGovernanceAuthorityV4"),
                abi.encode(SAFE, SAFE_RUNTIME_HASH, SAFE, uint64(1), SERVICE_RELEASE_BINDING)
            )
        );
        address[] memory deployments = _deployGraph(G1_NONCE, targets, "graph 1 gas");
        stack.store = deployments[0];
        stack.exactValidator = deployments[1];
        stack.reviewer = deployments[2];
        stack.governance = deployments[3];
    }

    function _deployGraph2(ReleaseStack memory stack) private {
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets = new ProgrammableCreate2GraphDeployerV1.Target[](4);
        targets[0] = _target(ID_UNIVERSAL_PREFLIGHT, _creation("ProgrammableUniversalLaunchPreflightV1"));
        targets[1] = _target(ID_CODEC, _creation("ProgrammableCompletedGraphAdoptionCompatCodecV1"));
        targets[2] = _target(
            ID_FINALITY,
            bytes.concat(
                _creation("ProgrammableRouterFinalityAuthorityV4"),
                abi.encode(SAFE, SAFE_RUNTIME_HASH, SAFE, uint64(1), SERVICE_RELEASE_BINDING)
            )
        );
        targets[3] = _target(
            ID_INDEXER,
            bytes.concat(
                _creation("ProgrammableRouterIndexerAuthorityV4"),
                abi.encode(SAFE, SAFE_RUNTIME_HASH, SAFE, uint64(1), SERVICE_RELEASE_BINDING)
            )
        );
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization = _authorization(G2A_NONCE, targets);
        stack.codec = graphDeployer.predictTarget(authorization, targets[1]);
        address[] memory deployments = _deployGraph(G2A_NONCE, targets, "graph 2a gas");
        stack.universalPreflight = deployments[0];
        assertEq(stack.codec, deployments[1]);
        stack.finality = deployments[2];
        stack.indexer = deployments[3];

        targets = new ProgrammableCreate2GraphDeployerV1.Target[](3);
        targets[0] = _target(
            ID_HOOKEMON_VALIDATOR,
            bytes.concat(_creation("ProgrammableCompletedGraphAdoptionValidatorV1"), abi.encode(stack.codec))
        );
        targets[1] = _target(
            ID_HOOKEMON_PREFLIGHT,
            bytes.concat(_creation("ProgrammableCompletedGraphAdoptionPreflightV1"), abi.encode(stack.codec))
        );
        targets[2] = _target(ID_HOOKEMON_STATE_VERIFIER, _creation("ProgrammableCompletedGraphRuntimeStateVerifierV1"));
        deployments = _deployGraph(G2B_NONCE, targets, "graph 2b gas");
        stack.hookemonValidator = deployments[0];
        stack.hookemonPreflight = deployments[1];
        stack.hookemonStateVerifier = deployments[2];
    }

    function _deployGraph3(ReleaseStack memory stack) private {
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory universalInitial = _universalControl(1, true);
        ProgrammableCompletedGraphAdoptionGrantRegistryV1.InitialControlStateV1 memory hookemonInitial =
            ProgrammableCompletedGraphAdoptionGrantRegistryV1.InitialControlStateV1({
                dependencyBehaviorEvidenceHash: keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_BEHAVIOR_EVIDENCE_V1"),
                securityControlHeadHash: keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_CONTROL_HEAD_1"),
                securityEpoch: 1,
                securityEpochHash: keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_SECURITY_1"),
                policyEpoch: 1,
                policyEpochHash: keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_POLICY_1"),
                reviewGeneration: 1,
                reviewGenerationHash: keccak256("PROGRAMMABLE_ROUTER_V4_HOOKEMON_REVIEW_1")
            });
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets = new ProgrammableCreate2GraphDeployerV1.Target[](1);
        targets[0] = _target(
            ID_KERNEL,
            bytes.concat(
                _creation("ProgrammableUniversalLaunchKernelV1"),
                abi.encode(
                    stack.reviewer,
                    stack.reviewer.codehash,
                    stack.governance,
                    stack.governance.codehash,
                    stack.finality,
                    stack.finality.codehash,
                    stack.indexer,
                    stack.indexer.codehash,
                    stack.universalPreflight,
                    stack.universalPreflight.codehash,
                    universalInitial
                )
            )
        );
        stack.kernel = _deployGraph(G3A_NONCE, targets, "graph 3a gas")[0];

        bytes memory registryInitCode = bytes.concat(
            _creation("ProgrammableCompletedGraphAdoptionGrantRegistryV1"),
            abi.encode(
                stack.reviewer,
                stack.governance,
                stack.finality,
                stack.indexer,
                stack.codec,
                stack.hookemonValidator,
                stack.hookemonPreflight,
                hookemonInitial
            )
        );
        stack.registry = _deployNickCreate2(REGISTRY_SALT, registryInitCode, "registry deployment gas");
        assertTrue(IProgrammableUniversalLaunchKernelV1(stack.kernel).controlStateV1().globalKilled);
    }

    function _bindAuthoritiesThroughLiveSafe(ReleaseStack memory stack) private {
        uint256 nonceBefore = ISafeV141(SAFE).nonce();
        bytes memory bindingCall = abi.encodeCall(
            ProgrammableRouterAuthorityV4Base.initializeConsumersV1,
            (stack.kernel, stack.kernel.codehash, stack.registry, stack.registry.codehash)
        );
        _safeExec(stack.reviewer, bindingCall, "reviewer binding gas");
        assertTrue(
            IProgrammableCompletedGraphAdoptionCompatV1(stack.registry)
            .preflightControlStateV1(bytes32(0))
            .globalAdoptionKilled
        );
        _safeExec(stack.governance, bindingCall, "governance binding gas");
        _safeExec(stack.finality, bindingCall, "finality binding gas");
        _safeExec(stack.indexer, bindingCall, "indexer binding gas");
        assertEq(ISafeV141(SAFE).nonce(), nonceBefore + 4);
        assertTrue(ProgrammableRouterAuthorityV4Base(stack.reviewer).initialized());
        assertTrue(ProgrammableRouterAuthorityV4Base(stack.governance).initialized());
        assertTrue(ProgrammableRouterAuthorityV4Base(stack.finality).initialized());
        assertTrue(ProgrammableRouterAuthorityV4Base(stack.indexer).initialized());
    }

    function _deployGraph4(ReleaseStack memory stack) private {
        bytes32 storeBinding = _staticBytes32(stack.store, abi.encodeWithSignature("runtimeBindingHashV1()"));
        bytes memory constructorArguments = abi.encode(
            stack.kernel,
            stack.kernel.codehash,
            stack.exactValidator,
            stack.exactValidator.codehash,
            stack.store,
            stack.store.codehash,
            storeBinding
        );
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets = new ProgrammableCreate2GraphDeployerV1.Target[](2);
        targets[0] = _target(
            ID_PROVIDER, bytes.concat(_creation("ProgrammableExactShardsNestedFactoryProviderV1"), constructorArguments)
        );
        targets[1] = _target(
            ID_VERIFIER, bytes.concat(_creation("ProgrammableExactShardsNestedFactoryVerifierV1"), constructorArguments)
        );
        address[] memory deployments = _deployGraph(G4_NONCE, targets, "graph 4 gas");
        stack.provider = deployments[0];
        stack.verifier = deployments[1];
        uint256 providerScanGasBefore = gasleft();
        IUniversalLaunchPreflightBindingV1(stack.universalPreflight)
            .closedRuntimeBindingHashV1(
                stack.provider,
                stack.provider.codehash,
                ProgrammableExactShardsNestedFactoryProviderV1(payable(stack.provider)).runtimeBindingHashV1(),
                true
            );
        emit log_named_uint("provider closed-runtime scan gas", providerScanGasBefore - gasleft());
        IProgrammableUniversalLaunchKernelV1(stack.kernel)
            .assertClosedRuntimeBindingV1(
                stack.provider,
                stack.provider.codehash,
                ProgrammableExactShardsNestedFactoryProviderV1(payable(stack.provider)).runtimeBindingHashV1(),
                true
            );
        IProgrammableUniversalLaunchKernelV1(stack.kernel)
            .assertClosedRuntimeBindingV1(
                stack.verifier,
                stack.verifier.codehash,
                ProgrammableExactShardsNestedFactoryVerifierV1(stack.verifier).runtimeBindingHashV1(),
                true
            );
    }

    function _deployGraph5(ReleaseStack memory stack) private {
        bytes32 providerBinding =
            ProgrammableExactShardsNestedFactoryProviderV1(payable(stack.provider)).runtimeBindingHashV1();
        bytes32 verifierBinding = ProgrammableExactShardsNestedFactoryVerifierV1(stack.verifier).runtimeBindingHashV1();
        bytes memory profileInitCode = bytes.concat(
            _creation("ProgrammableNestedFactoryProfileV1"),
            abi.encode(
                stack.kernel,
                stack.kernel.codehash,
                stack.provider,
                stack.provider.codehash,
                stack.verifier,
                stack.verifier.codehash,
                verifierBinding,
                PROFILE_KEY,
                providerBinding,
                uint32(12_000_000),
                uint32(600_000)
            )
        );
        stack.profile = _deployNickCreate2(PROFILE_SALT, profileInitCode, "profile deployment gas");
    }

    function _activateUniversalThroughLiveSafe(ReleaseStack memory stack) private {
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory next = _universalControl(2, false);
        bytes32 providerBinding =
            ProgrammableExactShardsNestedFactoryProviderV1(payable(stack.provider)).runtimeBindingHashV1();
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor;
        descriptor.profileKey = PROFILE_KEY;
        descriptor.schemaId = keccak256("NESTED_FACTORY_SCHEMA_V1");
        descriptor.profileVersion = 1;
        descriptor.capabilitySemantics = IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute;
        descriptor.module = stack.profile;
        descriptor.moduleRuntimeCodeHash = stack.profile.codehash;
        descriptor.actionTypeHash = keccak256(
            "NestedFactoryPlanV1(uint16 schemaVersion,bytes32 actionHash,bytes32 orderedComponentHeadHash,bytes32 componentGraphHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,bytes32 expectedStateHash)"
        );
        descriptor.exactContractBindingHash = providerBinding;
        descriptor.providerBindingHash = providerBinding;
        descriptor.revenuePolicyHash = REVENUE_POLICY_HASH;
        descriptor.securityControlHeadHash = next.securityControlHeadHash;
        descriptor.securityEpoch = next.securityEpoch;
        descriptor.securityEpochHash = next.securityEpochHash;
        descriptor.policyEpoch = next.policyEpoch;
        descriptor.policyEpochHash = next.policyEpochHash;
        descriptor.reviewGeneration = next.reviewGeneration;
        descriptor.reviewGenerationHash = next.reviewGenerationHash;
        descriptor.status = IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active;
        emit log_named_bytes32("Universal provider binding", providerBinding);
        emit log_named_bytes32("Universal security control head", next.securityControlHeadHash);
        emit log_named_bytes32("Universal security epoch hash", next.securityEpochHash);
        emit log_named_bytes32("Universal policy epoch hash", next.policyEpochHash);
        emit log_named_bytes32("Universal review generation hash", next.reviewGenerationHash);
        _safeExec(
            stack.governance,
            abi.encodeCall(ProgrammableRouterGovernanceAuthorityV4.activateUniversalProfileV1, (next, descriptor)),
            "universal activation gas"
        );
    }

    function _assertPreActivationState(ReleaseStack memory stack) private view {
        assertTrue(IProgrammableUniversalLaunchKernelV1(stack.kernel).controlStateV1().globalKilled);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightControlStateV1 memory hookemon =
            IProgrammableCompletedGraphAdoptionCompatV1(stack.registry).preflightControlStateV1(bytes32(0));
        assertTrue(hookemon.globalAdoptionKilled);
        assertEq(
            uint8(hookemon.profileStatus), uint8(IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Invalid)
        );
        assertTrue(FACTORY.code.length != 0 && RENDERER.code.length != 0);
        assertEq(TOKEN.code.length, 0);
        assertEq(HOOK.code.length, 0);
        assertEq(NFT.code.length, 0);
    }

    function _assertExpectedReleaseStack(ReleaseStack memory stack) private view {
        assertEq(address(graphDeployer), EXPECTED_GRAPH_DEPLOYER);
        assertEq(stack.store, EXPECTED_STORE);
        assertEq(stack.exactValidator, EXPECTED_EXACT_VALIDATOR);
        assertEq(stack.reviewer, EXPECTED_REVIEWER);
        assertEq(stack.governance, EXPECTED_GOVERNANCE);
        assertEq(stack.universalPreflight, EXPECTED_UNIVERSAL_PREFLIGHT);
        assertEq(stack.codec, EXPECTED_HOOKEMON_CODEC);
        assertEq(stack.hookemonValidator, EXPECTED_HOOKEMON_VALIDATOR);
        assertEq(stack.hookemonPreflight, EXPECTED_HOOKEMON_PREFLIGHT);
        assertEq(stack.hookemonStateVerifier, EXPECTED_HOOKEMON_STATE_VERIFIER);
        assertEq(stack.finality, EXPECTED_FINALITY);
        assertEq(stack.indexer, EXPECTED_INDEXER);
        assertEq(stack.kernel, EXPECTED_KERNEL);
        assertEq(stack.registry, EXPECTED_REGISTRY);
        assertEq(stack.provider, EXPECTED_PROVIDER);
        assertEq(stack.verifier, EXPECTED_VERIFIER);
        assertEq(stack.profile, EXPECTED_PROFILE);
        assertEq(IShardsStoreReadbackV1(stack.store).PART_0(), EXPECTED_STORE_PART_0);
        assertEq(IShardsStoreReadbackV1(stack.store).PART_1(), EXPECTED_STORE_PART_1);
    }

    function _activateCompletedGraphAdoptionCompatThroughLiveSafe(ReleaseStack memory stack) private {
        CompletedGraphCompatControlV1 memory next = _completedGraphCompatControl(2);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability =
            _completedGraphCompatCapability(stack, next);
        stack.hookemonProfileKey = capability.profileKey;
        assertEq(stack.hookemonProfileKey, EXPECTED_HOOKEMON_PROFILE_KEY);
        emit log_named_bytes32(
            "completed-graph compat capability hash",
            ProgrammableCompletedGraphAdoptionCompatCodecV1(stack.codec)
                .computeAdoptionProfileCapabilityHash(capability)
        );
        emit log_named_bytes32("completed-graph compat exact contract binding", capability.exactContractBindingHash);
        emit log_named_bytes32("completed-graph compat security control head", next.securityControlHeadHash);
        emit log_named_bytes32("completed-graph compat security epoch hash", next.securityEpochHash);
        emit log_named_bytes32("completed-graph compat policy epoch hash", next.policyEpochHash);
        emit log_named_bytes32("completed-graph compat review generation hash", next.reviewGenerationHash);
        _safeExec(
            stack.governance,
            abi.encodeCall(
                ProgrammableRouterGovernanceAuthorityV4.activateHookemonProfileV1,
                (
                    capability,
                    next.securityControlHeadHash,
                    next.securityEpoch,
                    next.securityEpochHash,
                    next.policyEpoch,
                    next.policyEpochHash,
                    next.reviewGeneration,
                    next.reviewGenerationHash
                )
            ),
            "completed-graph compat activation gas"
        );
    }

    function _assertFinalActiveState(ReleaseStack memory stack) private view {
        IProgrammableUniversalLaunchKernelV1 kernel = IProgrammableUniversalLaunchKernelV1(stack.kernel);
        assertFalse(kernel.controlStateV1().globalKilled);
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor =
            kernel.profileDescriptorV1(PROFILE_KEY);
        assertEq(descriptor.module, stack.profile);
        assertEq(uint8(descriptor.status), uint8(IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active));
        assertEq(IProgrammableNestedFactoryProfileBindingV1(stack.profile).PROVIDER(), stack.provider);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightControlStateV1 memory hookemon =
            IProgrammableCompletedGraphAdoptionCompatV1(stack.registry)
                .preflightControlStateV1(stack.hookemonProfileKey);
        assertFalse(hookemon.globalAdoptionKilled);
        assertEq(
            uint8(hookemon.profileStatus), uint8(IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1.Active)
        );
        assertTrue(hookemon.profileCapabilityHash != bytes32(0));
    }

    function _logReleaseStack(ReleaseStack memory stack) private {
        emit log_named_address("graph deployer", address(graphDeployer));
        emit log_named_address("Shards hook code store", stack.store);
        emit log_named_address("Exact Shards validator", stack.exactValidator);
        emit log_named_address("Reviewer Authority V4", stack.reviewer);
        emit log_named_address("Governance Authority V4", stack.governance);
        emit log_named_address("Universal preflight", stack.universalPreflight);
        emit log_named_address("completed-graph compat codec", stack.codec);
        emit log_named_address("completed-graph compat validator", stack.hookemonValidator);
        emit log_named_address("completed-graph compat preflight", stack.hookemonPreflight);
        emit log_named_address("completed-graph compat runtime state verifier", stack.hookemonStateVerifier);
        emit log_named_address("Finality Authority V4", stack.finality);
        emit log_named_address("Indexer Authority V4", stack.indexer);
        emit log_named_address("Universal kernel", stack.kernel);
        emit log_named_address("completed-graph compat registry", stack.registry);
        emit log_named_address("Shards provider", stack.provider);
        emit log_named_address("Shards verifier", stack.verifier);
        emit log_named_address("Nested factory profile", stack.profile);
        emit log_named_bytes32("completed-graph compat profile key", stack.hookemonProfileKey);
        emit log_named_bytes32("store runtime hash", stack.store.codehash);
        emit log_named_bytes32("exact validator runtime hash", stack.exactValidator.codehash);
        emit log_named_bytes32("reviewer runtime hash", stack.reviewer.codehash);
        emit log_named_bytes32("governance runtime hash", stack.governance.codehash);
        emit log_named_bytes32("universal preflight runtime hash", stack.universalPreflight.codehash);
        emit log_named_bytes32("codec runtime hash", stack.codec.codehash);
        emit log_named_bytes32("completed-graph compat validator runtime hash", stack.hookemonValidator.codehash);
        emit log_named_bytes32("completed-graph compat preflight runtime hash", stack.hookemonPreflight.codehash);
        emit log_named_bytes32(
            "completed-graph compat runtime state verifier hash", stack.hookemonStateVerifier.codehash
        );
        emit log_named_bytes32("finality runtime hash", stack.finality.codehash);
        emit log_named_bytes32("indexer runtime hash", stack.indexer.codehash);
        emit log_named_bytes32("kernel runtime hash", stack.kernel.codehash);
        emit log_named_bytes32("registry runtime hash", stack.registry.codehash);
        emit log_named_bytes32("provider runtime hash", stack.provider.codehash);
        emit log_named_bytes32("verifier runtime hash", stack.verifier.codehash);
        emit log_named_bytes32("profile runtime hash", stack.profile.codehash);
        emit log_named_address("Shards hook code part 0", IShardsStoreReadbackV1(stack.store).PART_0());
        emit log_named_bytes32("Shards hook code part 0 hash", IShardsStoreReadbackV1(stack.store).PART_0().codehash);
        emit log_named_address("Shards hook code part 1", IShardsStoreReadbackV1(stack.store).PART_1());
        emit log_named_bytes32("Shards hook code part 1 hash", IShardsStoreReadbackV1(stack.store).PART_1().codehash);
        emit log_named_bytes32(
            "Shards verifier binding",
            ProgrammableExactShardsNestedFactoryVerifierV1(stack.verifier).runtimeBindingHashV1()
        );
    }

    function _assertLiveSafeControllerSignaturePath(ReleaseStack memory stack) private {
        ProgrammableRouterReviewerAuthorityV4 reviewer = ProgrammableRouterReviewerAuthorityV4(stack.reviewer);
        bytes32 consumerDigest = keccak256("PROGRAMMABLE_ROUTER_V4_SAFE_ERC1271_FORK_PROBE_V1");
        uint8 purpose = reviewer.PURPOSE_UNIVERSAL_GRANT();
        bytes32 controllerDigest = reviewer.controllerDigestV1(consumerDigest, purpose, stack.kernel);
        bytes32 safeMessageHash = ISafeV141(SAFE).getMessageHash(abi.encode(controllerDigest));
        vm.prank(LAUNCHER);
        ISafeV141(SAFE).approveHash(safeMessageHash);
        bytes memory prevalidatedSignature =
            abi.encodePacked(bytes32(uint256(uint160(LAUNCHER))), bytes32(0), bytes1(uint8(1)));
        bytes memory authoritySignature = bytes.concat(bytes1(purpose), prevalidatedSignature);
        vm.prank(stack.kernel);
        bytes4 magicValue = reviewer.isValidSignature(consumerDigest, authoritySignature);
        uint256 authorityGas = uint256(vm.lastCallGas().gasTotalUsed);
        emit log_named_uint("live Safe Authority ERC-1271 gas", authorityGas);
        assertEq(magicValue, bytes4(0x1626ba7e));
        assertLt(authorityGas, 100_000);
    }

    function _simulateFullCompletedGraphAdoptionCompat(ReleaseStack memory stack) private {
        vm.mockCall(SAFE, abi.encodeWithSelector(bytes4(0x1626ba7e)), abi.encode(bytes4(0x1626ba7e)));
        CompletedGraphCompatFixtureV1 memory fixture = _completedGraphCompatFixture(stack);
        IProgrammableCompletedGraphAdoptionCompatV1 registry =
            IProgrammableCompletedGraphAdoptionCompatV1(stack.registry);

        bytes32 grantDigest = registry.activateLaunchGrantV1(fixture.adoption.grant, hex"0301");
        assertEq(grantDigest, registry.launchGrantDigest(fixture.adoption.grant));
        fixture.adoption.currentness.preflightReadbackHash = ProgrammableCompletedGraphAdoptionPreflightV1(
                stack.hookemonPreflight
            )
            .computeAdoptionPreflightAggregateV1(
                stack.registry,
                fixture.adoption,
                fixture.capability,
                grantDigest,
                fixture.adoption.grant.contractPlanHash
            );
        fixture.adoption.currentness.simulationEvidenceHash = keccak256(
            abi.encode(
                "PROGRAMMABLE_ROUTER_V4_HOOKEMON_FULL_STACK_SIMULATION_V1",
                fixture.adoption.currentness.preflightReadbackHash,
                fixture.adoption.plan.resultHash
            )
        );
        fixture.adoption.currentness.serviceDeploymentBindingHash = keccak256(
            abi.encode(
                "PROGRAMMABLE_ROUTER_V4_HOOKEMON_SERVICE_DEPLOYMENT_BINDING_V1",
                stack.registry,
                stack.registry.codehash,
                stack.hookemonStateVerifier,
                stack.hookemonStateVerifier.codehash
            )
        );
        fixture.adoption.currentness.dualProviderQuorumEvidenceHash = keccak256(
            abi.encode(
                "PROGRAMMABLE_ROUTER_V4_HOOKEMON_DUAL_PROVIDER_QUORUM_V1",
                fixture.adoption.currentness.preflightReadbackHash
            )
        );

        uint64 reviewGeneration = fixture.adoption.currentness.reviewControl.reviewGeneration;
        fixture.adoption.currentness.reviewControl.reviewGeneration = reviewGeneration - 1;
        vm.expectRevert();
        vm.prank(LAUNCH_WALLET);
        registry.adoptCompletedGraphV1(fixture.adoption);
        fixture.adoption.currentness.reviewControl.reviewGeneration = reviewGeneration;

        uint256 killSnapshot = vm.snapshotState();
        _safeExec(
            stack.reviewer,
            abi.encodeCall(ProgrammableRouterReviewerAuthorityV4.hookemonSetGlobalKillV1, ()),
            "completed-graph compat kill negative gas"
        );
        vm.expectRevert();
        vm.prank(LAUNCH_WALLET);
        registry.adoptCompletedGraphV1(fixture.adoption);
        assertTrue(vm.revertToStateAndDelete(killSnapshot));

        bytes memory transactionData =
            abi.encodeCall(IProgrammableCompletedGraphAdoptionCompatV1.adoptCompletedGraphV1, (fixture.adoption));
        uint256 intrinsicGas = _intrinsicGas(transactionData);
        vm.prank(LAUNCH_WALLET);
        bytes32 receiptCoreHash = registry.adoptCompletedGraphV1(fixture.adoption);
        uint256 transactionGas = uint256(vm.lastCallGas().gasTotalUsed) + intrinsicGas;
        emit log_named_uint("full completed-graph adoption compat gas", transactionGas);
        assertLt(transactionGas, MAINNET_TRANSACTION_GAS_LIMIT);
        assertTrue(receiptCoreHash != bytes32(0));
        assertEq(
            uint8(_completedGraphCompatReceiptStatus(stack.registry, fixture.adoption.request.stampLaunchId)),
            uint8(IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Adopted)
        );
        _appendSimulatedCompletedGraphCompatFinality(stack, fixture, receiptCoreHash);

        vm.expectRevert();
        vm.prank(LAUNCH_WALLET);
        registry.adoptCompletedGraphV1(fixture.adoption);
    }

    function _completedGraphCompatFixture(ReleaseStack memory stack)
        private
        returns (CompletedGraphCompatFixtureV1 memory fixture)
    {
        ProgrammableCompletedGraphAdoptionCompatCodecV1 codec =
            ProgrammableCompletedGraphAdoptionCompatCodecV1(stack.codec);
        CompletedGraphCompatControlV1 memory control = _completedGraphCompatControl(2);
        fixture.capability = _completedGraphCompatCapability(stack, control);

        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 memory plan;
        plan.profileKey = fixture.capability.profileKey;
        plan.profileDescriptorHash = fixture.capability.profileDescriptorHash;
        plan.exactContractBindingHash = fixture.capability.exactContractBindingHash;
        plan.routeSchemaHash = fixture.capability.routeSchemaHash;
        plan.planSchemaArtifactHash = fixture.capability.planSchemaArtifactHash;
        plan.sourceRepositoryHash = keccak256("GITHUB_0XPROGRAMMABLE_PROGRAMMABLE");
        plan.sourceCommitId = hex"5cb4f0c9769b420d5240d88c7b9a861fd3755ed1";
        plan.sourceTreeId = hex"28709a9112f421aabb1ca884bab2f40b1c6b4213";
        plan.sourceLaunchId = keccak256("PROGRAMMABLE_HOOKEMON_COMPLETED_GRAPH_SIMULATION_V1");
        plan.manifestHash = keccak256("PROGRAMMABLE_HOOKEMON_COMPLETED_GRAPH_SIMULATION_MANIFEST_V1");
        plan.policyHash = fixture.capability.policyHash;
        plan.compilerArtifactHash = keccak256("PROGRAMMABLE_HOOKEMON_COMPLETED_GRAPH_COMPILER_ARTIFACT_V1");
        plan.applicantPlanArtifactHash = keccak256("PROGRAMMABLE_HOOKEMON_COMPLETED_GRAPH_PLAN_ARTIFACT_V1");
        plan.adoptionIntentHash = keccak256("PROGRAMMABLE_HOOKEMON_COMPLETED_GRAPH_ADOPTION_INTENT_V1");
        plan.executionReadiness =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionReadinessV1.CompletedGraphAdoptionOnly;
        plan.executionReadinessConstraintHash = fixture.capability.executionReadinessConstraintHash;
        plan.executionTimeConstraint =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.AdoptionOnlyNoExecution;
        plan.launchWallet = LAUNCH_WALLET;
        plan.launchClassification =
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchClassificationV1.CompletedGraphAdoption;
        plan.identityMask =
            ProgrammableCompletedGraphRuntimeStateVerifierV1(stack.hookemonStateVerifier).IDENTITY_APPLICATION();
        plan.architectureResultHash = keccak256("PROGRAMMABLE_HOOKEMON_COMPLETED_GRAPH_ARCHITECTURE_RESULT_V1");
        plan.deploymentLineageHash = keccak256("PROGRAMMABLE_HOOKEMON_COMPLETED_GRAPH_DEPLOYMENT_LINEAGE_V1");

        TestOnlyCompletedGraphNodeV1 nodeA = new TestOnlyCompletedGraphNodeV1(1);
        TestOnlyCompletedGraphNodeV1 nodeB = new TestOnlyCompletedGraphNodeV1(2);
        address application = address(nodeA) < address(nodeB) ? address(nodeA) : address(nodeB);
        address auxiliary = address(nodeA) < address(nodeB) ? address(nodeB) : address(nodeA);
        fixture.adoption.components = new IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[](2);
        fixture.adoption.components[0] = _completedGraphCompatExternalComponent(
            application,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Application,
            keccak256("PROGRAMMABLE_HOOKEMON_SIMULATION_APPLICATION_V1")
        );
        fixture.adoption.components[1] = _completedGraphCompatExternalComponent(
            auxiliary,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Auxiliary,
            keccak256("PROGRAMMABLE_HOOKEMON_SIMULATION_AUXILIARY_V1")
        );
        fixture.adoption.edges = new IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[](1);
        fixture.adoption.edges[0] = IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1({
            fromIndex: 0,
            toIndex: 1,
            kind: IProgrammableCompletedGraphAdoptionCompatV1.EdgeKindV1.Controls,
            relationHash: keccak256("PROGRAMMABLE_HOOKEMON_SIMULATION_CONTROL_EDGE_V1")
        });
        for (uint256 i; i < fixture.adoption.components.length; ++i) {
            fixture.adoption.components[i].creationEvidenceHash =
                codec.computeComponentCreationEvidenceHash(stack.registry, plan, i, fixture.adoption.components[i]);
            fixture.adoption.components[i].configurationHash =
                codec.computeComponentConfigurationHash(fixture.adoption.components[i]);
        }
        plan.identities.applicationHash = codec.computeApplicationIdentityHash(fixture.adoption.components[0]);
        plan.componentGraphHash = codec.computeComponentGraphHash(fixture.adoption.components, fixture.adoption.edges);
        plan.exactRuntimeSetHash = codec.computeExactRuntimeSetHash(fixture.adoption.components);
        plan.componentConfigurationSetHash = codec.computeComponentConfigurationSetHash(fixture.adoption.components);
        plan.configurationHash = codec.computeConfigurationHash(
            plan.componentGraphHash,
            plan.componentConfigurationSetHash,
            plan.policyHash,
            bytes32(0),
            address(0),
            bytes32(0),
            bytes32(0),
            plan.architectureResultHash
        );
        plan.resultHash = codec.computeResultHash(
            plan.componentGraphHash,
            plan.configurationHash,
            plan.architectureResultHash,
            bytes32(0),
            plan.deploymentLineageHash
        );
        fixture.adoption.plan = plan;
        _bindCompletedGraphCompatRequestGrantAndCurrentness(stack, fixture);
    }

    function _bindCompletedGraphCompatRequestGrantAndCurrentness(
        ReleaseStack memory stack,
        CompletedGraphCompatFixtureV1 memory fixture
    ) private view {
        ProgrammableCompletedGraphAdoptionCompatCodecV1 codec =
            ProgrammableCompletedGraphAdoptionCompatCodecV1(stack.codec);
        bytes32 planHash = codec.computePlanHash(fixture.adoption.plan);
        bytes32 stampLaunchId = codec.computeStampLaunchId(
            stack.registry,
            LAUNCH_WALLET,
            fixture.adoption.plan.profileKey,
            planHash,
            fixture.adoption.plan.sourceLaunchId
        );
        fixture.adoption.request.stampLaunchId = stampLaunchId;
        fixture.adoption.request.profileKey = fixture.adoption.plan.profileKey;
        fixture.adoption.request.componentGraphHash = fixture.adoption.plan.componentGraphHash;
        fixture.adoption.request.resultHash = fixture.adoption.plan.resultHash;
        (fixture.adoption.request.currentArchitectureStateHash,,) = ProgrammableCompletedGraphRuntimeStateVerifierV1(
                stack.hookemonStateVerifier
            )
            .verifyCurrentStateV1(
                stack.registry,
                fixture.capability,
                fixture.adoption.plan,
                fixture.adoption.components,
                fixture.adoption.edges,
                fixture.adoption.request
            );

        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightControlStateV1 memory controls =
            IProgrammableCompletedGraphAdoptionCompatV1(stack.registry)
                .preflightControlStateV1(fixture.adoption.plan.profileKey);
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory grant;
        grant.chainId = block.chainid;
        grant.registry = stack.registry;
        grant.launchWallet = LAUNCH_WALLET;
        grant.applicantIdHash = keccak256("PROGRAMMABLE_HOOKEMON_SIMULATION_APPLICANT_V1");
        grant.profileKey = fixture.adoption.plan.profileKey;
        grant.profileDescriptorHash = fixture.adoption.plan.profileDescriptorHash;
        grant.exactContractBindingHash = fixture.adoption.plan.exactContractBindingHash;
        grant.contractPlanHash = planHash;
        grant.applicantPlanArtifactHash = fixture.adoption.plan.applicantPlanArtifactHash;
        grant.adoptionIntentHash = fixture.adoption.plan.adoptionIntentHash;
        grant.executionReadiness = fixture.adoption.plan.executionReadiness;
        grant.executionReadinessConstraintHash = fixture.adoption.plan.executionReadinessConstraintHash;
        grant.executionTimeConstraint = fixture.adoption.plan.executionTimeConstraint;
        grant.sourceRepositoryHash = fixture.adoption.plan.sourceRepositoryHash;
        grant.sourceCommitHash = codec.computeSourceCommitHash(fixture.adoption.plan.sourceCommitId);
        grant.sourceTreeHash = codec.computeSourceTreeHash(fixture.adoption.plan.sourceTreeId);
        grant.sourceLaunchId = fixture.adoption.plan.sourceLaunchId;
        grant.componentGraphHash = fixture.adoption.plan.componentGraphHash;
        grant.exactRuntimeSetHash = fixture.adoption.plan.exactRuntimeSetHash;
        grant.componentConfigurationSetHash = fixture.adoption.plan.componentConfigurationSetHash;
        grant.resultHash = fixture.adoption.plan.resultHash;
        grant.builderEvidenceHash = keccak256("PROGRAMMABLE_HOOKEMON_SIMULATION_BUILDER_EVIDENCE_V1");
        grant.reviewerAttestationHash = keccak256("PROGRAMMABLE_HOOKEMON_SIMULATION_REVIEWER_ATTESTATION_V1");
        grant.securityControlHeadHash = controls.securityControlHeadHash;
        grant.securityEpochHash = controls.securityEpochHash;
        grant.policyHash = fixture.adoption.plan.policyHash;
        grant.policyEpochHash = controls.policyEpochHash;
        grant.securityEpoch = controls.securityEpoch;
        grant.policyEpoch = controls.policyEpoch;
        grant.reviewControl = controls.reviewControl;
        grant.antiReplayNonce = keccak256("PROGRAMMABLE_HOOKEMON_SIMULATION_GRANT_NONCE_V1");
        grant.winnerKeyHash = codec.computeWinnerKeyHash(grant);
        fixture.adoption.grant = grant;

        bytes32 grantDigest = IProgrammableCompletedGraphAdoptionCompatV1(stack.registry).launchGrantDigest(grant);
        fixture.adoption.currentness.chainId = block.chainid;
        fixture.adoption.currentness.registry = stack.registry;
        fixture.adoption.currentness.launchWallet = LAUNCH_WALLET;
        fixture.adoption.currentness.launchGrantDigest = grantDigest;
        fixture.adoption.currentness.contractPlanHash = planHash;
        fixture.adoption.currentness.receiptRequestHash = codec.computeAdoptionRequestHash(fixture.adoption.request);
        fixture.adoption.currentness.expectedResultHash = fixture.adoption.plan.resultHash;
        fixture.adoption.currentness.adoptionIntentHash = fixture.adoption.plan.adoptionIntentHash;
        fixture.adoption.currentness.securityControlHeadHash = controls.securityControlHeadHash;
        fixture.adoption.currentness.securityEpochHash = controls.securityEpochHash;
        fixture.adoption.currentness.policyEpochHash = controls.policyEpochHash;
        fixture.adoption.currentness.securityEpoch = controls.securityEpoch;
        fixture.adoption.currentness.policyEpoch = controls.policyEpoch;
        fixture.adoption.currentness.reviewControl = controls.reviewControl;
        fixture.adoption.currentness.nonce = keccak256("PROGRAMMABLE_HOOKEMON_SIMULATION_CURRENTNESS_NONCE_V1");
        fixture.adoption.currentness.validAfter = uint64(block.timestamp - 1);
        fixture.adoption.currentness.deadline = uint64(block.timestamp + 300);
        fixture.adoption.currentnessSignature = hex"0401";
    }

    function _appendSimulatedCompletedGraphCompatFinality(
        ReleaseStack memory stack,
        CompletedGraphCompatFixtureV1 memory fixture,
        bytes32 receiptCoreHash
    ) private {
        ProgrammableCompletedGraphAdoptionCompatCodecV1 codec =
            ProgrammableCompletedGraphAdoptionCompatCodecV1(stack.codec);
        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 memory receipt;
        receipt.stampLaunchId = fixture.adoption.request.stampLaunchId;
        receipt.receiptCoreHash = receiptCoreHash;
        receipt.launchGrantDigest = fixture.adoption.currentness.launchGrantDigest;
        receipt.nextStatus = IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Finalized;
        receipt.evidenceHash = keccak256("PROGRAMMABLE_HOOKEMON_SIMULATED_FINALITY_EVIDENCE_V1");
        receipt.finalityIndexingReceiptHash = codec.computeFinalityIndexingReceiptHash(receipt);
        _safeExec(
            stack.finality,
            abi.encodeCall(ProgrammableRouterFinalityAuthorityV4.hookemonAdvanceFinalityV1, (receipt)),
            "completed-graph compat finality gas"
        );

        receipt.nextStatus = IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Indexed;
        receipt.previousFinalityIndexingReceiptHash = receipt.finalityIndexingReceiptHash;
        receipt.evidenceHash = keccak256("PROGRAMMABLE_HOOKEMON_SIMULATED_INDEXING_EVIDENCE_V1");
        receipt.finalityIndexingReceiptHash = codec.computeFinalityIndexingReceiptHash(receipt);
        _safeExec(
            stack.indexer,
            abi.encodeCall(ProgrammableRouterIndexerAuthorityV4.hookemonAdvanceIndexingV1, (receipt)),
            "completed-graph compat indexing gas"
        );

        receipt.nextStatus = IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Published;
        receipt.previousFinalityIndexingReceiptHash = receipt.finalityIndexingReceiptHash;
        receipt.evidenceHash = keccak256("PROGRAMMABLE_HOOKEMON_SIMULATED_PUBLICATION_EVIDENCE_V1");
        receipt.finalityIndexingReceiptHash = codec.computeFinalityIndexingReceiptHash(receipt);
        _safeExec(
            stack.indexer,
            abi.encodeCall(ProgrammableRouterIndexerAuthorityV4.hookemonAdvanceIndexingV1, (receipt)),
            "completed-graph compat publication gas"
        );
        assertEq(
            uint8(_completedGraphCompatReceiptStatus(stack.registry, fixture.adoption.request.stampLaunchId)),
            uint8(IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Published)
        );
        assertEq(
            IProgrammableCompletedGraphAdoptionCompatV1(stack.registry)
            .canonicalReceiptCore(fixture.adoption.request.stampLaunchId)
            .receiptCoreHash,
            receiptCoreHash
        );
    }

    function _completedGraphCompatExternalComponent(
        address account,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1 kind,
        bytes32 externalCanonicalIdHash
    ) private view returns (IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 memory component) {
        component.account = account;
        component.kind = kind;
        component.scope = IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.Exclusive;
        component.deploymentKind = IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.ExternalCanonical;
        component.externalCanonicalIdHash = externalCanonicalIdHash;
        component.runtimeCodeHash = account.codehash;
    }

    function _completedGraphCompatReceiptStatus(address registry, bytes32 stampLaunchId)
        private
        view
        returns (IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1)
    {
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionPreflightQueryV1 memory query;
        query.stampLaunchId = stampLaunchId;
        return IProgrammableCompletedGraphAdoptionCompatV1(registry)
        .preflightGrantReceiptStateV1(query, bytes32(0))
        .receiptStatus;
    }

    function _simulateFullUniversalExecution(ReleaseStack memory stack) private {
        vm.mockCall(SAFE, abi.encodeWithSelector(bytes4(0x1626ba7e)), abi.encode(bytes4(0x1626ba7e)));
        TestOnlyAlwaysValid1271V1 walletSigner = new TestOnlyAlwaysValid1271V1();
        vm.etch(LAUNCH_WALLET, address(walletSigner).code);

        IProgrammableNestedFactoryProfileV1 profile = IProgrammableNestedFactoryProfileV1(stack.profile);
        IProgrammableUniversalLaunchKernelV1 kernel = IProgrammableUniversalLaunchKernelV1(stack.kernel);
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan = _exactPlan(stack.provider);
        _assertPreflightNegativeMatrix(stack, plan);
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant = _launchGrant(kernel, plan, stack.provider);
        bytes32 grantDigest = kernel.activateLaunchGrantV1(grant, hex"0101");
        assertEq(grantDigest, kernel.computeLaunchGrantDigestV1(grant));

        IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations =
            profile.nestedFactoryReservationsV1(plan);
        bytes32 profilePreflightHash = profile.computeNestedFactoryPreflightHashV1(plan);
        bytes32 kernelPreflightHash = IUniversalLaunchPreflightBindingV1(stack.universalPreflight)
            .atomicPreflightHashV1(stack.kernel, stack.kernel.codehash, grantDigest, reservations);
        IProgrammableNestedFactoryProfileV1.LaunchTransportV1 memory transport =
            _launchTransport(kernel, grant, grantDigest, kernelPreflightHash, profilePreflightHash);

        bytes memory transactionData =
            abi.encodeCall(IProgrammableNestedFactoryProfileV1.launchNestedFactoryV1, (grantDigest, plan, transport));
        uint256 intrinsicGas = _intrinsicGas(transactionData);
        vm.prank(LAUNCH_WALLET);
        bytes32 receiptCoreHash = profile.launchNestedFactoryV1(grantDigest, plan, transport);
        uint256 transactionGas = uint256(vm.lastCallGas().gasTotalUsed) + intrinsicGas;
        emit log_named_uint("full universal Shards execution gas", transactionGas);
        assertLt(transactionGas, MAINNET_TRANSACTION_GAS_LIMIT);
        assertTrue(receiptCoreHash != bytes32(0));
        assertTrue(TOKEN.code.length != 0 && HOOK.code.length != 0 && NFT.code.length != 0);

        IProgrammableUniversalLaunchKernelV1.CanonicalLaunchReceiptV1 memory receipt =
            kernel.canonicalLaunchReceiptV1(grantDigest);
        assertEq(uint8(receipt.status), uint8(IProgrammableUniversalLaunchKernelV1.ReceiptStatus.Executed));
        assertEq(receipt.receiptCoreHash, receiptCoreHash);
        _appendSimulatedFinality(kernel, grantDigest, grant.stampLaunchId, receiptCoreHash);

        vm.prank(LAUNCH_WALLET);
        vm.expectRevert();
        profile.launchNestedFactoryV1(grantDigest, plan, transport);
    }

    function _deployShardsFactory() private {
        bytes memory initCode =
            bytes.concat(_creation("ShardLaunchFactoryV1"), abi.encode(POOL_MANAGER, HOOK_CREATION_CODE_HASH));
        address deployment = _deployNickCreate2(FACTORY_SALT, initCode, "Shards factory deployment gas");
        assertEq(deployment, FACTORY);
        assertTrue(RENDERER.code.length != 0);
        assertEq(TOKEN.code.length, 0);
        assertEq(HOOK.code.length, 0);
        assertEq(NFT.code.length, 0);
    }

    function _assertPreflightNegativeMatrix(
        ReleaseStack memory stack,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan
    ) private {
        address[3] memory exclusiveComponents = [TOKEN, HOOK, NFT];
        for (uint256 i; i < exclusiveComponents.length; ++i) {
            uint256 snapshotId = vm.snapshotState();
            vm.etch(exclusiveComponents[i], hex"00");
            vm.expectRevert();
            IProgrammableNestedFactoryProfileV1(stack.profile).computeNestedFactoryPreflightHashV1(plan);
            assertTrue(vm.revertToStateAndDelete(snapshotId));
        }

        address[4] memory runtimeDependencies = [
            FACTORY,
            RENDERER,
            IShardsStoreReadbackV1(stack.store).PART_0(),
            IShardsStoreReadbackV1(stack.store).PART_1()
        ];
        for (uint256 i; i < runtimeDependencies.length; ++i) {
            uint256 snapshotId = vm.snapshotState();
            vm.etch(runtimeDependencies[i], hex"00");
            vm.expectRevert();
            IProgrammableNestedFactoryProfileV1(stack.profile).computeNestedFactoryPreflightHashV1(plan);
            assertTrue(vm.revertToStateAndDelete(snapshotId));
        }
    }

    function _exactPlan(address providerAddress)
        private
        view
        returns (IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan)
    {
        ProgrammableExactShardsNestedFactoryProviderV1 provider =
            ProgrammableExactShardsNestedFactoryProviderV1(payable(providerAddress));
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

    function _launchGrant(
        IProgrammableUniversalLaunchKernelV1 kernel,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan,
        address providerAddress
    ) private view returns (IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant) {
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control = kernel.controlStateV1();
        bytes32 providerBinding =
            ProgrammableExactShardsNestedFactoryProviderV1(payable(providerAddress)).runtimeBindingHashV1();
        grant.schemaVersion = 1;
        grant.applicantWallet = LAUNCH_WALLET;
        grant.applicantIdHash = keccak256("PROGRAMMABLE_EXACT_SHARDS_APPLICANT_V1");
        grant.profileKey = PROFILE_KEY;
        grant.planHash = IProgrammableNestedFactoryProfileV1(address(kernel.profileDescriptorV1(PROFILE_KEY).module))
            .computeNestedFactoryPlanHashV1(plan);
        grant.sourceRepoHash = keccak256("GITHUB_0XPROGRAMMABLE_PROGRAMMABLE");
        grant.sourceCommit = bytes20(hex"5cb4f0c9769b420d5240d88c7b9a861fd3755ed1");
        grant.sourceTree = bytes20(hex"28709a9112f421aabb1ca884bab2f40b1c6b4213");
        grant.sourceLaunchId = SOURCE_LAUNCH_ID;
        grant.antiReplayNonce = keccak256("PROGRAMMABLE_EXACT_SHARDS_SIMULATION_NONCE_V1");
        grant.componentGraphHash = plan.componentGraphHash;
        grant.componentRuntimeSetHash = plan.componentRuntimeSetHash;
        grant.configurationHash = CONFIGURATION_HASH;
        grant.builderEvidenceHash = keccak256("PROGRAMMABLE_EXACT_SHARDS_BUILDER_EVIDENCE_V1");
        grant.reviewerAttestationHash = keccak256("PROGRAMMABLE_EXACT_SHARDS_REVIEWER_ATTESTATION_V1");
        grant.exactContractBindingHash = providerBinding;
        grant.providerBindingHash = providerBinding;
        grant.revenueBindingHash = REVENUE_POLICY_HASH;
        grant.securityControlHeadHash = control.securityControlHeadHash;
        grant.securityEpoch = control.securityEpoch;
        grant.securityEpochHash = control.securityEpochHash;
        grant.policyEpoch = control.policyEpoch;
        grant.policyEpochHash = control.policyEpochHash;
        grant.reviewGeneration = control.reviewGeneration;
        grant.reviewGenerationHash = control.reviewGenerationHash;
        grant.stampLaunchId = kernel.computeStampLaunchIdV1(grant);
    }

    function _launchTransport(
        IProgrammableUniversalLaunchKernelV1 kernel,
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant,
        bytes32 grantDigest,
        bytes32 kernelPreflightHash,
        bytes32 profilePreflightHash
    ) private view returns (IProgrammableNestedFactoryProfileV1.LaunchTransportV1 memory transport) {
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control = kernel.controlStateV1();
        transport.currentness.grantDigest = grantDigest;
        transport.currentness.profileKey = PROFILE_KEY;
        transport.currentness.planHash = grant.planHash;
        transport.currentness.executionMode = IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute;
        transport.currentness.kernelPreflightReadbackHash = kernelPreflightHash;
        transport.currentness.profilePreflightReadbackHash = profilePreflightHash;
        transport.currentness.dualProviderQuorumEvidenceHash = keccak256("DUAL_PROVIDER_SIMULATION_EVIDENCE_V1");
        transport.currentness.simulationEvidenceHash = keccak256("FULL_STACK_SIMULATION_EVIDENCE_V1");
        transport.currentness.serviceDeploymentBindingHash = keccak256("ROUTER_V4_DEPLOYMENT_BINDING_V1");
        transport.currentness.currentnessNonce = keccak256("ROUTER_V4_CURRENTNESS_NONCE_V1");
        transport.currentness.securityControlHeadHash = control.securityControlHeadHash;
        transport.currentness.securityEpoch = control.securityEpoch;
        transport.currentness.securityEpochHash = control.securityEpochHash;
        transport.currentness.policyEpoch = control.policyEpoch;
        transport.currentness.policyEpochHash = control.policyEpochHash;
        transport.currentness.reviewGeneration = control.reviewGeneration;
        transport.currentness.reviewGenerationHash = control.reviewGenerationHash;
        transport.currentness.validAfter = uint64(block.timestamp - 1);
        transport.currentness.deadline = uint64(block.timestamp + 300);
        transport.currentnessSignature = hex"0201";
        transport.walletIntent.grantDigest = grantDigest;
        transport.walletIntent.stampLaunchId = grant.stampLaunchId;
        transport.walletIntent.antiReplayNonce = grant.antiReplayNonce;
        transport.walletIntent.profileModule = kernel.profileDescriptorV1(PROFILE_KEY).module;
        transport.walletIntent.intentNonce = keccak256("ROUTER_V4_WALLET_INTENT_NONCE_V1");
        transport.walletIntent.validAfter = uint64(block.timestamp - 1);
        transport.walletIntent.deadline = uint64(block.timestamp + 300);
        transport.walletSignature = hex"01";
    }

    function _appendSimulatedFinality(
        IProgrammableUniversalLaunchKernelV1 kernel,
        bytes32 grantDigest,
        bytes32 stampLaunchId,
        bytes32 receiptCoreHash
    ) private {
        IProgrammableUniversalLaunchKernelV1.FinalityIndexingReceiptV1 memory receipt;
        receipt.grantDigest = grantDigest;
        receipt.stampLaunchId = stampLaunchId;
        receipt.receiptCoreHash = receiptCoreHash;
        receipt.transactionHash = keccak256("SIMULATED_SHARDS_EXECUTION_TRANSACTION_V1");
        receipt.blockNumber = uint64(block.number);
        receipt.blockHash = keccak256("SIMULATED_FINALIZED_BLOCK_V1");
        receipt.finalizedAt = uint64(block.timestamp);
        receipt.deploymentReceiptHash = keccak256("SIMULATED_DEPLOYMENT_RECEIPTS_V1");
        receipt.sourceVerificationReceiptHash = keccak256("SIMULATED_SOURCE_VERIFICATION_V1");
        receipt.status = IProgrammableUniversalLaunchKernelV1.ReceiptStatus.Finalized;
        kernel.appendFinalityIndexingV1(receipt, hex"0501");
        receipt.indexingReceiptHash = keccak256("SIMULATED_INDEXING_RECEIPT_V1");
        receipt.status = IProgrammableUniversalLaunchKernelV1.ReceiptStatus.IndexedPublished;
        kernel.appendFinalityIndexingV1(receipt, hex"0601");
        assertEq(
            uint8(kernel.canonicalLaunchReceiptV1(grantDigest).status),
            uint8(IProgrammableUniversalLaunchKernelV1.ReceiptStatus.IndexedPublished)
        );
    }

    function _deployGraph(
        bytes32 routeNonce,
        ProgrammableCreate2GraphDeployerV1.Target[] memory targets,
        string memory label
    ) private returns (address[] memory deployments) {
        ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization = _authorization(routeNonce, targets);
        (authorization.graphCommitment,) = graphDeployer.computeGraphCommitment(authorization, targets);
        bytes memory transactionData =
            abi.encodeCall(ProgrammableCreate2GraphDeployerV1.deployGraph, (authorization, targets));
        emit log_named_bytes32(string.concat(label, " commitment"), authorization.graphCommitment);
        emit log_named_bytes32(string.concat(label, " calldata hash"), keccak256(transactionData));
        uint256 intrinsicGas = _intrinsicGas(transactionData);
        vm.prank(LAUNCHER);
        (deployments,,,) = graphDeployer.deployGraph(authorization, targets);
        uint256 transactionGas = uint256(vm.lastCallGas().gasTotalUsed) + intrinsicGas;
        emit log_named_uint(label, transactionGas);
        assertLt(transactionGas, MAINNET_TRANSACTION_GAS_LIMIT);
        for (uint256 i; i < deployments.length; ++i) {
            assertTrue(deployments[i].code.length != 0);
            assertEq(deployments[i], graphDeployer.predictTarget(authorization, targets[i]));
            emit log_named_bytes32("target id", targets[i].targetIdHash);
            emit log_named_bytes32("target applicant salt", targets[i].applicantSalt);
            emit log_named_bytes32(
                "target effective salt",
                graphDeployer.effectiveTargetSalt(authorization, targets[i].targetIdHash, targets[i].applicantSalt)
            );
            emit log_named_bytes32("target init code hash", keccak256(targets[i].initCode));
            emit log_named_address("target deployment", deployments[i]);
            emit log_named_bytes32("target runtime hash", deployments[i].codehash);
        }
    }

    function _authorization(bytes32 routeNonce, ProgrammableCreate2GraphDeployerV1.Target[] memory targets)
        private
        pure
        returns (ProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization)
    {
        bytes32[] memory targetIds = new bytes32[](targets.length);
        for (uint256 i; i < targets.length; ++i) {
            targetIds[i] = targets[i].targetIdHash;
        }
        authorization.routeNamespace = ROUTE_NAMESPACE;
        authorization.routeNonce = routeNonce;
        authorization.topologyHash = keccak256(abi.encode(targetIds));
        authorization.authorizedLauncher = LAUNCHER;
        authorization.totalValue = 0;
    }

    function _target(bytes32 id, bytes memory initCode)
        private
        pure
        returns (ProgrammableCreate2GraphDeployerV1.Target memory target)
    {
        target.targetIdHash = id;
        target.applicantSalt = keccak256(abi.encode("PROGRAMMABLE_ROUTER_V4_TARGET_SALT_V1", id));
        target.initCode = initCode;
    }

    function _safeExec(address target, bytes memory data, string memory label) private {
        bytes memory prevalidatedSignature =
            abi.encodePacked(bytes32(uint256(uint160(LAUNCHER))), bytes32(0), bytes1(uint8(1)));
        bytes memory transactionData = abi.encodeCall(
            ISafeV141.execTransaction,
            (target, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), prevalidatedSignature)
        );
        emit log_named_bytes32(string.concat(label, " calldata hash"), keccak256(transactionData));
        uint256 intrinsicGas = _intrinsicGas(transactionData);
        vm.prank(LAUNCHER);
        bool success = ISafeV141(SAFE)
            .execTransaction(target, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), prevalidatedSignature);
        uint256 gasUsed = uint256(vm.lastCallGas().gasTotalUsed) + intrinsicGas;
        emit log_named_uint(label, gasUsed);
        assertTrue(success);
        assertLt(gasUsed, MAINNET_TRANSACTION_GAS_LIMIT);
    }

    function _completedGraphCompatCapability(ReleaseStack memory stack, CompletedGraphCompatControlV1 memory control)
        private
        view
        returns (IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability)
    {
        ProgrammableCompletedGraphRuntimeStateVerifierV1
            verifier = ProgrammableCompletedGraphRuntimeStateVerifierV1(stack.hookemonStateVerifier);
        ProgrammableCompletedGraphAdoptionCompatCodecV1 codec =
            ProgrammableCompletedGraphAdoptionCompatCodecV1(stack.codec);
        capability.profileDescriptorHash = verifier.PROFILE_DESCRIPTOR_HASH();
        capability.routeSchemaHash = verifier.ROUTE_SCHEMA_HASH();
        capability.profileKey = codec.computeProfileKey(capability.profileDescriptorHash, capability.routeSchemaHash);
        capability.exactContractBindingHash = verifier.exactContractBindingHashV1(stack.registry);
        capability.planSchemaArtifactHash = verifier.PLAN_SCHEMA_ARTIFACT_HASH();
        capability.policyHash = verifier.POLICY_HASH();
        capability.stateVerifierBinding = IProgrammableCompletedGraphAdoptionCompatV1.StateVerifierBindingV1({
            stateVerifier: stack.hookemonStateVerifier,
            stateVerifierRuntimeCodeHash: stack.hookemonStateVerifier.codehash,
            stateSchemaHash: verifier.STATE_SCHEMA_HASH(),
            stateVerifierBehaviorEvidenceHash: verifier.STATE_VERIFIER_BEHAVIOR_EVIDENCE_HASH()
        });
        capability.reviewControl = IProgrammableCompletedGraphAdoptionCompatV1.ReviewGenerationV1({
            reviewGenerationHash: control.reviewGenerationHash, reviewGeneration: control.reviewGeneration
        });
        capability.capabilitySemantics = IProgrammableCompletedGraphAdoptionCompatV1.CapabilitySemanticsV1.Adopt;
        capability.admissionStatus = IProgrammableCompletedGraphAdoptionCompatV1.AdmissionStatusV1.Admitted;
        capability.launchClassification =
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchClassificationV1.CompletedGraphAdoption;
        capability.executionReadiness =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionReadinessV1.CompletedGraphAdoptionOnly;
        capability.executionReadinessConstraintHash = codec.ADOPTION_ONLY_READINESS_CONSTRAINT_HASH();
        capability.executionTimeConstraint =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.AdoptionOnlyNoExecution;
        capability.requiredIdentityMask = verifier.IDENTITY_APPLICATION();
        capability.forbiddenIdentityMask = verifier.IDENTITY_POOL();
        capability.enabled = true;
    }

    function _completedGraphCompatControl(uint64 generation)
        private
        pure
        returns (CompletedGraphCompatControlV1 memory control)
    {
        control.securityControlHeadHash =
            keccak256(abi.encode("PROGRAMMABLE_ROUTER_V4_HOOKEMON_CONTROL_HEAD", generation));
        control.securityEpoch = generation;
        control.securityEpochHash = keccak256(abi.encode("PROGRAMMABLE_ROUTER_V4_HOOKEMON_SECURITY", generation));
        control.policyEpoch = generation;
        control.policyEpochHash = keccak256(abi.encode("PROGRAMMABLE_ROUTER_V4_HOOKEMON_POLICY", generation));
        control.reviewGeneration = generation;
        control.reviewGenerationHash = keccak256(abi.encode("PROGRAMMABLE_ROUTER_V4_HOOKEMON_REVIEW", generation));
    }

    function _universalControl(uint64 generation, bool killed)
        private
        pure
        returns (IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control)
    {
        control.securityControlHeadHash = keccak256(abi.encode("PROGRAMMABLE_ROUTER_V4_CONTROL_HEAD", generation));
        control.securityEpoch = generation;
        control.securityEpochHash = keccak256(abi.encode("PROGRAMMABLE_ROUTER_V4_SECURITY", generation));
        control.policyEpoch = generation;
        control.policyEpochHash = keccak256(abi.encode("PROGRAMMABLE_ROUTER_V4_POLICY", generation));
        control.reviewGeneration = generation;
        control.reviewGenerationHash = keccak256(abi.encode("PROGRAMMABLE_ROUTER_V4_REVIEW", generation));
        control.globalKilled = killed;
    }

    function _creation(string memory name) private view returns (bytes memory) {
        string memory bytecode =
            vm.readFile(string.concat("../../artifacts/router-v4-deployment-v1/bytecodes/", name, ".json"));
        return vm.parseJsonBytes(bytecode, ".creationBytecode");
    }

    function _expectedRuntimeTemplateHash(string memory name) private view returns (bytes32) {
        string memory bytecode =
            vm.readFile(string.concat("../../artifacts/router-v4-deployment-v1/bytecodes/", name, ".json"));
        return vm.parseJsonBytes32(bytecode, ".runtimeTemplateKeccak256");
    }

    function _staticBytes32(address target, bytes memory data) private view returns (bytes32 result) {
        (bool success, bytes memory output) = target.staticcall(data);
        assertTrue(success);
        result = abi.decode(output, (bytes32));
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }

    function _deployNickCreate2(bytes32 salt, bytes memory initCode, string memory label)
        private
        returns (address deployment)
    {
        deployment = _create2Address(NICK_CREATE2_PROXY, salt, keccak256(initCode));
        assertEq(deployment.code.length, 0);
        bytes memory transactionData = bytes.concat(salt, initCode);
        emit log_named_bytes32(string.concat(label, " salt"), salt);
        emit log_named_bytes32(string.concat(label, " init code hash"), keccak256(initCode));
        emit log_named_bytes32(string.concat(label, " calldata hash"), keccak256(transactionData));
        uint256 intrinsicGas = _intrinsicGas(transactionData);
        // A top-level transaction gives the proxy only gasLimit - intrinsicGas.  Supplying that exact
        // budget here reproduces the EIP-150 CREATE2 child-call bottleneck that a gas-rich test frame
        // otherwise hides.
        uint256 outerExecutionGas = MAINNET_TRANSACTION_GAS_LIMIT - intrinsicGas;
        vm.prank(LAUNCHER);
        (bool success, bytes memory result) = NICK_CREATE2_PROXY.call{ gas: outerExecutionGas }(transactionData);
        uint256 transactionGas = uint256(vm.lastCallGas().gasTotalUsed) + intrinsicGas;
        emit log_named_uint(label, transactionGas);
        assertTrue(success);
        assertEq(result.length, 20);
        assertEq(address(bytes20(result)), deployment);
        assertLt(transactionGas, MAINNET_TRANSACTION_GAS_LIMIT);
    }

    function _intrinsicGas(bytes memory transactionData) private pure returns (uint256 gasUsed) {
        gasUsed = 21_000;
        for (uint256 i; i < transactionData.length; ++i) {
            gasUsed += transactionData[i] == 0 ? 4 : 16;
        }
    }
}
