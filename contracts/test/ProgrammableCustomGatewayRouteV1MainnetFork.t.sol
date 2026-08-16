// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";

import { ProgrammableCreate2GraphDeployerV1 } from "../src/ProgrammableCreate2GraphDeployerV1.sol";
import {
    ProgrammableCustomGatewayRoutePairCoordinatorV1
} from "../src/ProgrammableCustomGatewayRoutePairCoordinatorV1.sol";
import { ProgrammableCustomLaunchGatewayV1 } from "../src/ProgrammableCustomLaunchGatewayV1.sol";
import { ProgrammableRouteGatedCreate2GraphFactoryV1 } from "../src/ProgrammableRouteGatedCreate2GraphFactoryV1.sol";
import { IProgrammableCreate2GraphDeployerV1 } from "../src/interfaces/IProgrammableCreate2GraphDeployerV1.sol";
import { IProgrammableCustomLaunchGatewayV1 } from "../src/interfaces/IProgrammableCustomLaunchGatewayV1.sol";
import { IProgrammableCustomRegistryV2 } from "../src/interfaces/IProgrammableCustomRegistryV2.sol";

contract ProgrammableGatewayGraphNodeV1 {
    bytes32 public constant NODE_ID = keccak256("programmable.gateway-graph-node.v1");
}

contract ProgrammableGatewayValueNodeV1 {
    uint256 public deploymentValue;
    uint256 public initializerValue;

    constructor() payable {
        deploymentValue = msg.value;
    }

    function initialize() external payable {
        initializerValue = msg.value;
    }
}

contract ProgrammableGatewayReentrantInitializerV1 {
    error ReentryUnexpectedlySucceeded();

    function initialize(address gateway, bytes calldata reentryCalldata) external {
        (bool success, bytes memory returnData) = gateway.call(reentryCalldata);
        if (success) revert ReentryUnexpectedlySucceeded();
        assembly ("memory-safe") {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}

interface IProgrammableCustomRegistryV2ForkRoles {
    function APPROVER_ROLE() external view returns (bytes32);
    function REGISTRAR_ROLE() external view returns (bytes32);
    function FINALIZER_ROLE() external view returns (bytes32);
    function operationalController(bytes32 role) external view returns (address);
    function approvalCount() external view returns (uint64);
    function registrationCount() external view returns (uint64);
    function transitionCount() external view returns (uint64);
}

abstract contract ProgrammableCustomGatewayRouteV1ForkBase is Test {
    uint256 internal constant MAINNET_FORK_BLOCK = 25_767_247;
    bytes32 internal constant MAINNET_FORK_PARENT_HASH =
        0x0cc77a00518a8e871f7d077a9c482b020da044bb0eec12563d0498003ab52f33;
    address internal constant REGISTRY = 0x845506084a1AfB969fa4DeF444A2bdeEe794AAad;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 internal constant REGISTRY_RUNTIME_HASH =
        0x74d8196e2d40d030c66b147e835cbdf6dd0ab61c964fb3ef3890d86ed7daf074;
    bytes32 internal constant POOL_MANAGER_RUNTIME_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 internal constant IMPLEMENTATION_RUNTIME_HASH =
        0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8;
    bytes32 internal constant GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH = keccak256(
        "ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)"
    );
    bytes32 internal constant ADAPTER_BINDING_HASH = 0x3c853d582a2904c3d86f69d5b793e354140765208a72eb4c11de2ea991a9812b;
    address internal constant USER = address(0xA11CE);

    ProgrammableCreate2GraphDeployerV1 internal implementation;
    ProgrammableCustomGatewayRoutePairCoordinatorV1 internal coordinator;
    ProgrammableRouteGatedCreate2GraphFactoryV1 internal factory;
    ProgrammableCustomLaunchGatewayV1 internal gateway;

    function setUp() public virtual {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        vm.createSelectFork(rpc, MAINNET_FORK_BLOCK);
        assertEq(block.number, MAINNET_FORK_BLOCK);
        assertEq(blockhash(MAINNET_FORK_BLOCK - 1), MAINNET_FORK_PARENT_HASH);
        assertEq(REGISTRY.codehash, REGISTRY_RUNTIME_HASH);
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_RUNTIME_HASH);
        coordinator = new ProgrammableCustomGatewayRoutePairCoordinatorV1(ADAPTER_BINDING_HASH);
        implementation = ProgrammableCreate2GraphDeployerV1(coordinator.IMPLEMENTATION());
        assertEq(address(implementation).codehash, IMPLEMENTATION_RUNTIME_HASH);
        factory = coordinator.factory();
        gateway = coordinator.gateway();
    }

    function _execution()
        internal
        view
        returns (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        )
    {
        targets = new IProgrammableCreate2GraphDeployerV1.Target[](1);
        targets[0] = IProgrammableCreate2GraphDeployerV1.Target({
            targetIdHash: keccak256("primary"),
            applicantSalt: keccak256("applicant-salt"),
            deploymentValue: 0,
            initializerValue: 0,
            initCode: type(ProgrammableGatewayGraphNodeV1).creationCode,
            initializerCalldata: bytes("")
        });
        IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization =
            IProgrammableCreate2GraphDeployerV1.GraphAuthorization({
                routeNamespace: keccak256("application-route-namespace"),
                // Preserve the current Generic-v2 derivation from routeNamespace + routeGenerationHash.
                // The independent Registry approval ID is passed beside it in the Gateway execution tuple.
                routeNonce: keccak256("generic-v2-derived-route-nonce"),
                topologyHash: keccak256("reviewed-topology"),
                graphCommitment: bytes32(0),
                authorizedLauncher: address(gateway),
                totalValue: 0
            });
        (authorization.graphCommitment,) = factory.computeGraphCommitment(authorization, targets);
        address primaryContract = factory.predictTarget(authorization, targets[0]);
        bytes32 expectedGraphDeploymentHash = _expectedGraphDeploymentHash(authorization, targets);
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory descriptor =
            IProgrammableCustomRegistryV2.LaunchDescriptorV2({
                chainId: 1,
                launchWallet: USER,
                primaryContract: primaryContract,
                primaryRuntimeCodeHash: keccak256(type(ProgrammableGatewayGraphNodeV1).runtimeCode),
                componentSetHash: sha256("reviewed-component-set"),
                sourceArtifactHash: sha256("reviewed-source-artifact"),
                configurationHash: sha256("reviewed-configuration"),
                launchPlanHash: sha256("reviewed-launch-plan-json"),
                projectCommitment: sha256("reviewed-project"),
                marketMode: IProgrammableCustomRegistryV2.MarketMode.Market,
                protocolFeeBps: 10
            });
        execution = IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1({
            descriptor: descriptor,
            approvalId: bytes32(0),
            authorization: authorization,
            primaryTargetIndex: 0,
            expectedGraphDeploymentHash: expectedGraphDeploymentHash
        });
        _bindApprovalWindow(execution, uint64(block.number), uint64(block.number + 100));
    }

    function _authorize(IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution)
        internal
        returns (bytes32 descriptorHash)
    {
        return _authorizeWindow(execution, uint64(block.number), uint64(block.number + 100));
    }

    function _authorizeWindow(
        IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
        uint64 validAfterBlock,
        uint64 expiresAtBlock
    ) internal returns (bytes32 descriptorHash) {
        descriptorHash = IProgrammableCustomRegistryV2(REGISTRY).computeDescriptorHash(execution.descriptor);
        IProgrammableCustomRegistryV2.ApprovalStateV2 memory approval = IProgrammableCustomRegistryV2.ApprovalStateV2({
            descriptorHash: descriptorHash,
            validAfterBlock: validAfterBlock,
            expiresAtBlock: expiresAtBlock,
            approvalEvidenceHash: sha256("approval-evidence"),
            consumed: false
        });
        vm.mockCall(
            REGISTRY,
            abi.encodeCall(IProgrammableCustomRegistryV2.approvalState, (execution.approvalId)),
            abi.encode(approval)
        );
    }

    function _bindApprovalWindow(
        IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
        uint64 validAfterBlock,
        uint64 expiresAtBlock
    ) internal view {
        execution.approvalId = gateway.computeExecutionApprovalId(execution, validAfterBlock, expiresAtBlock);
    }

    function _expectedGraphDeploymentHash(
        IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
        IProgrammableCreate2GraphDeployerV1.Target[] memory targets
    ) internal view returns (bytes32 accumulator) {
        return _expectedGraphDeploymentHashWithRuntime(
            authorization, targets, keccak256(type(ProgrammableGatewayGraphNodeV1).runtimeCode)
        );
    }

    function _expectedGraphDeploymentHashWithRuntime(
        IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization,
        IProgrammableCreate2GraphDeployerV1.Target[] memory targets,
        bytes32 runtimeCodeHash
    ) internal view returns (bytes32 accumulator) {
        accumulator = authorization.graphCommitment;
        for (uint256 index; index < targets.length; ++index) {
            IProgrammableCreate2GraphDeployerV1.Target memory target = targets[index];
            address deployment = factory.predictTarget(authorization, target);
            accumulator = keccak256(
                abi.encode(
                    GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH,
                    accumulator,
                    index,
                    target.targetIdHash,
                    deployment,
                    factory.effectiveTargetSalt(authorization, target.targetIdHash, target.applicantSalt),
                    keccak256(target.initCode),
                    keccak256(target.initializerCalldata),
                    runtimeCodeHash,
                    target.deploymentValue,
                    target.initializerValue
                )
            );
        }
    }
}

contract ProgrammableCustomGatewayRouteV1MainnetForkTest is ProgrammableCustomGatewayRouteV1ForkBase {
    function test_liveRegistryRolesCompleteApprovalExecutionRegistrationAndFinality() public {
        IProgrammableCustomRegistryV2 registry = IProgrammableCustomRegistryV2(REGISTRY);
        IProgrammableCustomRegistryV2ForkRoles roles = IProgrammableCustomRegistryV2ForkRoles(REGISTRY);
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        bytes32 descriptorHash = registry.computeDescriptorHash(execution.descriptor);
        assertEq(roles.approvalCount(), 0);
        assertEq(roles.registrationCount(), 0);
        assertEq(roles.transitionCount(), 0);
        vm.recordLogs();

        _authorizeLive(registry, roles, execution, descriptorHash);
        vm.prank(USER);
        gateway.executeApprovedGraph(execution, targets);
        vm.roll(block.number + gateway.ROUTE_CONFIRMATION_BLOCKS());
        bytes32 launchId = _registerLive(registry, roles, execution, descriptorHash);
        _finalizeLive(registry, roles, launchId);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        _assertLiveLifecycle(registry, roles, execution, launchId, descriptorHash);
        assertTrue(
            _containsEmitterTopic0(
                logs, REGISTRY, IProgrammableCustomRegistryV2.CustomLaunchApprovalAuthorizedV2.selector
            )
        );
        assertTrue(
            _containsEmitterTopic0(
                logs,
                address(factory),
                ProgrammableCreate2GraphDeployerV1.ProgrammableCreate2GraphTargetDeployed.selector
            )
        );
        assertTrue(
            _containsEmitterTopic0(
                logs, address(factory), ProgrammableCreate2GraphDeployerV1.ProgrammableCreate2GraphDeployed.selector
            )
        );
        assertTrue(
            _containsEmitterTopic0(
                logs, address(gateway), IProgrammableCustomLaunchGatewayV1.ProgrammableCustomGraphExecutedV1.selector
            )
        );
        assertTrue(
            _containsEmitterTopic0(logs, REGISTRY, IProgrammableCustomRegistryV2.CustomLaunchRegisteredV2.selector)
        );
        assertTrue(
            _containsEmitterTopic0(
                logs, REGISTRY, IProgrammableCustomRegistryV2.CustomLaunchDescriptorCommittedV2.selector
            )
        );
        assertTrue(
            _containsEmitterTopic0(logs, REGISTRY, IProgrammableCustomRegistryV2.CustomLaunchFinalizedV2.selector)
        );
    }

    function _authorizeLive(
        IProgrammableCustomRegistryV2 registry,
        IProgrammableCustomRegistryV2ForkRoles roles,
        IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
        bytes32 descriptorHash
    ) private {
        IProgrammableCustomRegistryV2.ApprovalAuthorizationV2 memory authorization =
            IProgrammableCustomRegistryV2.ApprovalAuthorizationV2({
                approvalId: execution.approvalId,
                descriptorHash: descriptorHash,
                validAfterBlock: uint64(block.number),
                expiresAtBlock: uint64(block.number + 100),
                approvalEvidenceHash: sha256("live-fork-approval-evidence")
            });
        address approver = roles.operationalController(roles.APPROVER_ROLE());
        vm.prank(approver);
        registry.authorizeApproval(authorization);
    }

    function _registerLive(
        IProgrammableCustomRegistryV2 registry,
        IProgrammableCustomRegistryV2ForkRoles roles,
        IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
        bytes32 descriptorHash
    ) private returns (bytes32 launchId) {
        address registrar = roles.operationalController(roles.REGISTRAR_ROLE());
        bytes32 registrationEvidenceHash = sha256("live-fork-registration-evidence");
        vm.prank(registrar);
        bytes32 registeredDescriptorHash;
        (launchId, registeredDescriptorHash) =
            registry.registerLaunch(execution.descriptor, execution.approvalId, registrationEvidenceHash);
        assertEq(registeredDescriptorHash, descriptorHash);
    }

    function _finalizeLive(
        IProgrammableCustomRegistryV2 registry,
        IProgrammableCustomRegistryV2ForkRoles roles,
        bytes32 launchId
    ) private {
        uint64 observedBlock = uint64(block.number);
        uint64 confirmedHeadBlock = observedBlock + 12;
        bytes32 observedBlockHash = keccak256("simulated-canonical-observed-block");
        bytes32 confirmedHeadBlockHash = keccak256("simulated-canonical-confirmed-head");
        vm.roll(uint256(confirmedHeadBlock) + 1);
        vm.setBlockhash(observedBlock, observedBlockHash);
        vm.setBlockhash(confirmedHeadBlock, confirmedHeadBlockHash);
        IProgrammableCustomRegistryV2.FinalityEvidenceV2 memory finality =
            IProgrammableCustomRegistryV2.FinalityEvidenceV2({
                observedBlockHash: observedBlockHash,
                confirmedHeadBlock: confirmedHeadBlock,
                confirmedHeadBlockHash: confirmedHeadBlockHash,
                finalityEvidenceHash: sha256("live-fork-finality-evidence")
            });
        address finalizer = roles.operationalController(roles.FINALIZER_ROLE());
        vm.prank(finalizer);
        registry.finalizeLaunch(launchId, finality);
    }

    function _assertLiveLifecycle(
        IProgrammableCustomRegistryV2 registry,
        IProgrammableCustomRegistryV2ForkRoles roles,
        IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
        bytes32 launchId,
        bytes32 descriptorHash
    ) private view {
        IProgrammableCustomRegistryV2.LaunchStateV2 memory state = registry.launchState(launchId);
        IProgrammableCustomRegistryV2.ApprovalStateV2 memory approval = registry.approvalState(execution.approvalId);
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory registered = registry.launchDescriptor(launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV2.LaunchStatus.Finalized));
        assertEq(state.descriptorHash, descriptorHash);
        assertEq(state.approvalId, execution.approvalId);
        assertEq(state.approvalEvidenceHash, sha256("live-fork-approval-evidence"));
        assertEq(state.registrationEvidenceHash, sha256("live-fork-registration-evidence"));
        assertEq(registered.primaryContract, execution.descriptor.primaryContract);
        assertEq(registry.computeDescriptorHash(registered), descriptorHash);
        assertTrue(approval.consumed);
        assertEq(gateway.executedDescriptorByApprovalId(execution.approvalId), descriptorHash);
        assertEq(roles.approvalCount(), 1);
        assertEq(roles.registrationCount(), 1);
        assertEq(roles.transitionCount(), 3);
    }

    function test_exactApprovedUserTransactionDeploysReviewedGraph() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        bytes32 descriptorHash = _authorize(execution);

        vm.prank(USER);
        (address[] memory deployments, bytes32[] memory runtimeHashes,, bytes32 deploymentHash) =
            gateway.executeApprovedGraph(execution, targets);

        assertEq(deployments.length, 1);
        assertEq(deployments[0], execution.descriptor.primaryContract);
        assertEq(runtimeHashes[0], execution.descriptor.primaryRuntimeCodeHash);
        assertEq(deploymentHash, execution.expectedGraphDeploymentHash);
        assertNotEq(execution.authorization.routeNonce, execution.approvalId);
        assertEq(gateway.executedDescriptorByApprovalId(execution.approvalId), descriptorHash);
        assertEq(deployments[0].codehash, execution.descriptor.primaryRuntimeCodeHash);
        assertFalse(IProgrammableCustomRegistryV2(REGISTRY).approvalState(execution.approvalId).consumed);
    }

    function test_nonzeroDeploymentAndInitializerValuesReachOnlyReviewedTarget() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        uint256 deploymentValue = 0.2 ether;
        uint256 initializerValue = 0.3 ether;
        targets[0].deploymentValue = deploymentValue;
        targets[0].initializerValue = initializerValue;
        targets[0].initCode = type(ProgrammableGatewayValueNodeV1).creationCode;
        targets[0].initializerCalldata = abi.encodeCall(ProgrammableGatewayValueNodeV1.initialize, ());
        _refreshSingleTargetExecution(
            execution,
            targets,
            keccak256(type(ProgrammableGatewayValueNodeV1).runtimeCode),
            deploymentValue + initializerValue
        );
        _authorize(execution);

        vm.deal(USER, deploymentValue + initializerValue);
        vm.prank(USER);
        (address[] memory deployments,,,) =
            gateway.executeApprovedGraph{ value: deploymentValue + initializerValue }(execution, targets);

        ProgrammableGatewayValueNodeV1 node = ProgrammableGatewayValueNodeV1(deployments[0]);
        assertEq(node.deploymentValue(), deploymentValue);
        assertEq(node.initializerValue(), initializerValue);
        assertEq(address(node).balance, deploymentValue + initializerValue);
        assertEq(address(gateway).balance, 0);
        assertEq(address(factory).balance, 0);
        assertEq(address(implementation).balance, 0);
    }

    function test_initializerReentryRevertsEntireApprovalAndDeployment() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory emptyExecution;
        IProgrammableCreate2GraphDeployerV1.Target[] memory emptyTargets =
            new IProgrammableCreate2GraphDeployerV1.Target[](0);
        bytes memory reentryCalldata =
            abi.encodeCall(IProgrammableCustomLaunchGatewayV1.executeApprovedGraph, (emptyExecution, emptyTargets));
        targets[0].initCode = type(ProgrammableGatewayReentrantInitializerV1).creationCode;
        targets[0].initializerCalldata =
            abi.encodeCall(ProgrammableGatewayReentrantInitializerV1.initialize, (address(gateway), reentryCalldata));
        _refreshSingleTargetExecution(
            execution, targets, keccak256(type(ProgrammableGatewayReentrantInitializerV1).runtimeCode), 0
        );
        bytes32 descriptorHash = _authorize(execution);
        bytes32 authorizationKey = factory.graphAuthorizationKey(execution.authorization);

        vm.prank(USER);
        vm.expectPartialRevert(ProgrammableCreate2GraphDeployerV1.InitializerCallFailed.selector);
        gateway.executeApprovedGraph(execution, targets);

        assertEq(execution.descriptor.primaryContract.code.length, 0);
        assertEq(gateway.executedDescriptorByApprovalId(execution.approvalId), bytes32(0));
        assertFalse(factory.consumedGraphAuthorization(authorizationKey));
        assertNotEq(descriptorHash, bytes32(0));
    }

    function _refreshSingleTargetExecution(
        IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
        IProgrammableCreate2GraphDeployerV1.Target[] memory targets,
        bytes32 runtimeCodeHash,
        uint256 totalValue
    ) private view {
        execution.authorization.totalValue = totalValue;
        (execution.authorization.graphCommitment,) = factory.computeGraphCommitment(execution.authorization, targets);
        execution.descriptor.primaryContract = factory.predictTarget(execution.authorization, targets[0]);
        execution.descriptor.primaryRuntimeCodeHash = runtimeCodeHash;
        execution.expectedGraphDeploymentHash =
            _expectedGraphDeploymentHashWithRuntime(execution.authorization, targets, runtimeCodeHash);
        _bindApprovalWindow(execution, uint64(block.number), uint64(block.number + 100));
    }

    function test_factoryRejectsEveryDirectCaller() public {
        (, IProgrammableCreate2GraphDeployerV1.Target[] memory targets) = _execution();
        IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableRouteGatedCreate2GraphFactoryV1.UnauthorizedGateway.selector,
                address(this),
                address(gateway)
            )
        );
        factory.deployGraph(authorization, targets);
    }

    function test_wrongLaunchWalletFailsBeforeDeployment() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        _authorize(execution);
        address attacker = address(0xB0B);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomLaunchGatewayV1.LaunchWalletMismatch.selector, attacker, USER)
        );
        gateway.executeApprovedGraph(execution, targets);
        assertEq(execution.descriptor.primaryContract.code.length, 0);
    }

    function test_exactApprovedDescriptorMutationFailsClosed() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        _authorize(execution);
        execution.descriptor.launchPlanHash = bytes32(uint256(execution.descriptor.launchPlanHash) ^ 1);
        vm.prank(USER);
        vm.expectPartialRevert(ProgrammableCustomLaunchGatewayV1.ApprovalDescriptorMismatch.selector);
        gateway.executeApprovedGraph(execution, targets);
        assertEq(execution.descriptor.primaryContract.code.length, 0);
    }

    function test_userSuppliedExpectedGraphDeploymentMutationFailsBeforeDeployment() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        _authorize(execution);
        execution.expectedGraphDeploymentHash = bytes32(uint256(execution.expectedGraphDeploymentHash) ^ 1);
        vm.prank(USER);
        vm.expectPartialRevert(ProgrammableCustomLaunchGatewayV1.ApprovalExecutionBindingMismatch.selector);
        gateway.executeApprovedGraph(execution, targets);
        assertEq(execution.descriptor.primaryContract.code.length, 0);
    }

    function test_initializerMutationFailsApprovalBindingBeforeDeployment() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        _authorize(execution);
        targets[0].initializerCalldata = abi.encodeWithSignature("initialize(bytes32)", keccak256("mutated"));
        (execution.authorization.graphCommitment,) = factory.computeGraphCommitment(execution.authorization, targets);
        execution.expectedGraphDeploymentHash = _expectedGraphDeploymentHash(execution.authorization, targets);

        vm.prank(USER);
        vm.expectPartialRevert(ProgrammableCustomLaunchGatewayV1.ApprovalExecutionBindingMismatch.selector);
        gateway.executeApprovedGraph(execution, targets);

        assertEq(execution.descriptor.primaryContract.code.length, 0);
        assertFalse(factory.consumedGraphAuthorization(factory.graphAuthorizationKey(execution.authorization)));
    }

    function test_unapprovedSidecarFailsApprovalBindingBeforeDeployment() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory reviewedTargets
        ) = _execution();
        _authorize(execution);
        IProgrammableCreate2GraphDeployerV1.Target[] memory mutatedTargets =
            new IProgrammableCreate2GraphDeployerV1.Target[](2);
        mutatedTargets[0] = reviewedTargets[0];
        mutatedTargets[1] = IProgrammableCreate2GraphDeployerV1.Target({
            targetIdHash: keccak256("unapproved-sidecar"),
            applicantSalt: keccak256("unapproved-sidecar-salt"),
            deploymentValue: 0,
            initializerValue: 0,
            initCode: type(ProgrammableGatewayGraphNodeV1).creationCode,
            initializerCalldata: bytes("")
        });
        (execution.authorization.graphCommitment,) =
            factory.computeGraphCommitment(execution.authorization, mutatedTargets);
        execution.expectedGraphDeploymentHash = _expectedGraphDeploymentHash(execution.authorization, mutatedTargets);

        vm.prank(USER);
        vm.expectPartialRevert(ProgrammableCustomLaunchGatewayV1.ApprovalExecutionBindingMismatch.selector);
        gateway.executeApprovedGraph(execution, mutatedTargets);

        assertEq(execution.descriptor.primaryContract.code.length, 0);
        assertEq(factory.predictTarget(execution.authorization, mutatedTargets[1]).code.length, 0);
        assertFalse(factory.consumedGraphAuthorization(factory.graphAuthorizationKey(execution.authorization)));
    }

    function test_registrationSafetyWindowRejectsLastConfirmationBlock() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        uint64 expiresAtBlock = uint64(block.number + gateway.ROUTE_CONFIRMATION_BLOCKS());
        _bindApprovalWindow(execution, uint64(block.number), expiresAtBlock);
        _authorizeWindow(execution, uint64(block.number), expiresAtBlock);
        uint256 requiredThroughBlock = block.number + gateway.REGISTRATION_SAFETY_MARGIN_BLOCKS();

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomLaunchGatewayV1.ApprovalRegistrationWindowInsufficient.selector,
                expiresAtBlock,
                requiredThroughBlock
            )
        );
        gateway.executeApprovedGraph(execution, targets);
        assertEq(execution.descriptor.primaryContract.code.length, 0);
    }

    function test_registrationSafetyWindowAllowsExactMargin() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        uint64 expiresAtBlock = uint64(block.number + gateway.REGISTRATION_SAFETY_MARGIN_BLOCKS());
        _bindApprovalWindow(execution, uint64(block.number), expiresAtBlock);
        _authorizeWindow(execution, uint64(block.number), expiresAtBlock);

        vm.prank(USER);
        (address[] memory deployments,,,) = gateway.executeApprovedGraph(execution, targets);
        assertEq(deployments[0], execution.descriptor.primaryContract);
    }

    function test_successfulApprovalCannotReplay() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        bytes32 descriptorHash = _authorize(execution);
        vm.prank(USER);
        gateway.executeApprovedGraph(execution, targets);
        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomLaunchGatewayV1.ApprovalAlreadyExecuted.selector, execution.approvalId, descriptorHash
            )
        );
        gateway.executeApprovedGraph(execution, targets);
    }

    function test_poolManagerRuntimeDriftFailsClosed() public {
        (
            IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,
            IProgrammableCreate2GraphDeployerV1.Target[] memory targets
        ) = _execution();
        _authorize(execution);
        vm.etch(POOL_MANAGER, hex"00");
        vm.prank(USER);
        vm.expectPartialRevert(ProgrammableCustomLaunchGatewayV1.DependencyRuntimeCodeHashMismatch.selector);
        gateway.executeApprovedGraph(execution, targets);
    }

    function testFuzz_descriptorHashBindsCurrentLaunchPlanHash(bytes32 changed) public view {
        (IProgrammableCustomLaunchGatewayV1.ApprovedGraphExecutionV1 memory execution,) = _execution();
        bytes32 reviewed = IProgrammableCustomRegistryV2(REGISTRY).computeDescriptorHash(execution.descriptor);
        vm.assume(changed != bytes32(0) && changed != execution.descriptor.launchPlanHash);
        execution.descriptor.launchPlanHash = changed;
        assertNotEq(IProgrammableCustomRegistryV2(REGISTRY).computeDescriptorHash(execution.descriptor), reviewed);
    }

    function test_exactGenericV2DeploySelectorIsPreserved() public pure {
        assertEq(IProgrammableCreate2GraphDeployerV1.deployGraph.selector, bytes4(0x196d9f22));
        assertEq(
            IProgrammableCreate2GraphDeployerV1.deployGraph.selector,
            ProgrammableCreate2GraphDeployerV1.deployGraph.selector
        );
        assertEq(IProgrammableCustomLaunchGatewayV1.computeExecutionApprovalId.selector, bytes4(0x0473df78));
        assertEq(
            IProgrammableCustomLaunchGatewayV1.computeExecutionApprovalId.selector,
            ProgrammableCustomLaunchGatewayV1.computeExecutionApprovalId.selector
        );
    }

    function test_exactGenericV2CompatibilityGettersArePreserved() public view {
        assertEq(
            factory.GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH(), implementation.GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH()
        );
        assertEq(factory.MAX_INITIALIZER_REVERT_BYTES(), implementation.MAX_INITIALIZER_REVERT_BYTES());
    }

    function _containsEmitterTopic0(Vm.Log[] memory logs, address emitter, bytes32 topic0) private pure returns (bool) {
        for (uint256 index; index < logs.length; ++index) {
            if (logs[index].emitter == emitter && logs[index].topics.length != 0 && logs[index].topics[0] == topic0) {
                return true;
            }
        }
        return false;
    }
}

contract ProgrammableCustomGatewayRouteGateHandlerV1 {
    ProgrammableRouteGatedCreate2GraphFactoryV1 internal immutable factory;
    uint256 public callCount;
    uint256 public successCount;

    constructor(ProgrammableRouteGatedCreate2GraphFactoryV1 factory_) {
        factory = factory_;
        _attempt(bytes32(0), bytes32(0), bytes32(0), bytes32(0));
    }

    function attempt(bytes32 routeNamespace, bytes32 routeNonce, bytes32 topologyHash, bytes32 graphCommitment)
        external
    {
        _attempt(routeNamespace, routeNonce, topologyHash, graphCommitment);
    }

    function _attempt(bytes32 routeNamespace, bytes32 routeNonce, bytes32 topologyHash, bytes32 graphCommitment)
        private
    {
        IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization =
            IProgrammableCreate2GraphDeployerV1.GraphAuthorization({
                routeNamespace: routeNamespace,
                routeNonce: routeNonce,
                topologyHash: topologyHash,
                graphCommitment: graphCommitment,
                authorizedLauncher: address(this),
                totalValue: 0
            });
        IProgrammableCreate2GraphDeployerV1.Target[] memory targets =
            new IProgrammableCreate2GraphDeployerV1.Target[](0);
        ++callCount;
        (bool success,) = address(factory)
            .call(abi.encodeCall(IProgrammableCreate2GraphDeployerV1.deployGraph, (authorization, targets)));
        if (success) ++successCount;
    }
}

contract ProgrammableCustomGatewayRouteV1InvariantTest is ProgrammableCustomGatewayRouteV1ForkBase {
    ProgrammableCustomGatewayRouteGateHandlerV1 internal handler;

    function setUp() public override {
        super.setUp();
        handler = new ProgrammableCustomGatewayRouteGateHandlerV1(factory);
        targetContract(address(handler));
        targetSender(address(0xBEEF));
    }

    function invariant_onlyImmutableGatewayCanReachDelegateImplementation() public view {
        assertGt(handler.callCount(), 0);
        assertEq(handler.successCount(), 0);
    }
}
