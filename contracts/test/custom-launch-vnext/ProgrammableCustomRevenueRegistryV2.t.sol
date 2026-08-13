// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Test } from "forge-std/Test.sol";

import {
    IProgrammableProtocolFeeSourceV1,
    ProgrammableProtocolFeeSourceBaseV1,
    ProtocolRevenueSourceConfigV1
} from "../../src/protocol-revenue-vnext/IProgrammableProtocolFeeSourceV1.sol";
import { ProtocolRevenueCollectorV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueCollectorV1.sol";
import { ProtocolRevenueClaimExecutorV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueClaimExecutorV1.sol";
import { ProtocolRevenueSourceRegistryV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueSourceRegistryV1.sol";
import {
    ProtocolRevenueCustomClaimRecorderV1
} from "../../src/protocol-revenue-vnext/custom/ProtocolRevenueCustomClaimRecorderV1.sol";
import {
    CustomRevenueApprovalStateV2,
    CustomRevenueLaunchStateV2,
    CustomRevenueLaunchStatusV2,
    ProgrammableLaunchStampRecordV1
} from "../../src/protocol-revenue-vnext/custom/IProgrammableCustomRevenueReleaseV2.sol";
import {
    ProtocolRevenueCustomLaunchRegistrarV1
} from "../../src/protocol-revenue-vnext/custom/ProtocolRevenueCustomLaunchRegistrarV1.sol";
import {
    ProgrammableCustomRevenueRegistryV2
} from "../../src/custom-launch-vnext/ProgrammableCustomRevenueRegistryV2.sol";

contract ProductionFutureCustomFeeSourceMock is ProgrammableProtocolFeeSourceBaseV1 {
    using Address for address payable;

    receive() external payable { }

    function programmableFeeBps(address asset) external pure returns (uint16) {
        if (asset != address(0)) revert UnsupportedProtocolRevenueAsset(asset);
        return 10;
    }

    function accrueNative() external payable {
        _accrueProgrammableFee(address(0), msg.value);
    }

    function claimProgrammableFees(address asset) external returns (uint256 amount) {
        amount = _consumeProgrammableFees(asset);
        if (amount != 0) payable(PROGRAMMABLE_REWARD_WALLET).sendValue(amount);
    }
}

contract ProductionCreate2DeployerMock {
    function deploy(bytes32 salt, bytes memory creationCode) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        require(deployed != address(0), "CREATE2_FAILED");
    }
}

contract ProductionApprovedFactoryMock { }

contract TestableProgrammableCustomRevenueRegistryV2 is ProgrammableCustomRevenueRegistryV2 {
    address internal immutable TEST_POOL_MANAGER;
    bytes32 internal immutable TEST_POOL_MANAGER_RUNTIME_CODE_HASH;

    constructor(RegistryConfigV2 memory config, address poolManager) ProgrammableCustomRevenueRegistryV2(config) {
        TEST_POOL_MANAGER = poolManager;
        TEST_POOL_MANAGER_RUNTIME_CODE_HASH = poolManager.codehash;
    }

    function _assertCanonicalPoolManager(address supplied) internal view override {
        if (
            supplied != TEST_POOL_MANAGER || supplied.code.length == 0
                || supplied.codehash != TEST_POOL_MANAGER_RUNTIME_CODE_HASH
        ) revert InfrastructureBindingMismatch("pool-manager");
    }
}

contract ProgrammableCustomRevenueRegistryV2Test is Test {
    address internal constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    address internal admin = makeAddr("admin");
    address internal bootstrapProposer = makeAddr("bootstrapProposer");
    address internal activator = makeAddr("activator");
    address internal quarantiner = makeAddr("quarantiner");
    address internal approver = makeAddr("approver");
    address internal launchRecorder = makeAddr("launchRecorder");
    address internal finalizer = makeAddr("finalizer");
    address internal launchAdmitter = makeAddr("launchAdmitter");
    address internal launchWallet = makeAddr("launchWallet");
    address internal token = makeAddr("token");

    bytes32 internal constant LAUNCH_ID = keccak256("production-future-custom-launch");
    bytes32 internal constant APPROVAL_ID = keccak256("production-future-custom-approval");
    bytes32 internal constant REGISTRATION_BINDING = keccak256("production-registration-binding");
    bytes32 internal constant TEMPLATE_COMMITMENT = keccak256("production-template-commitment");
    bytes32 internal constant CREATE2_SALT = keccak256("production-source-salt");

    ProtocolRevenueSourceRegistryV1 internal sourceRegistry;
    TestableProgrammableCustomRevenueRegistryV2 internal registry;
    ProtocolRevenueCustomLaunchRegistrarV1 internal registrar;
    ProductionCreate2DeployerMock internal create2Deployer;
    ProductionApprovedFactoryMock internal approvedFactory;
    ProductionApprovedFactoryMock internal poolManager;

    bytes internal creationCode;
    bytes32 internal creationCodeHash;
    bytes32 internal sourceRuntimeCodeHash;
    address internal predictedSource;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        ProtocolRevenueCollectorV1 collector = new ProtocolRevenueCollectorV1();
        sourceRegistry = new ProtocolRevenueSourceRegistryV1(
            2 days, admin, bootstrapProposer, activator, quarantiner, address(collector)
        );
        poolManager = new ProductionApprovedFactoryMock();
        registry = new TestableProgrammableCustomRevenueRegistryV2(
            ProgrammableCustomRevenueRegistryV2.RegistryConfigV2({
                initialAdminDelay: 2 days,
                initialAdmin: admin,
                initialApprover: approver,
                initialLaunchRecorder: launchRecorder,
                initialFinalizer: finalizer,
                independentSourceActivator: activator,
                sourceRegistry: address(sourceRegistry),
                sourceRegistryRuntimeCodeHash: address(sourceRegistry).codehash
            }),
            address(poolManager)
        );
        registrar = new ProtocolRevenueCustomLaunchRegistrarV1(
            ProtocolRevenueCustomLaunchRegistrarV1.RegistrarConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: admin,
                initialLaunchAdmitter: launchAdmitter,
                sourceRegistry: address(sourceRegistry),
                sourceRegistryRuntimeCodeHash: address(sourceRegistry).codehash,
                customRegistryV2: address(registry),
                customRegistryV2RuntimeCodeHash: address(registry).codehash,
                launchStampRouter: address(registry),
                launchStampRouterRuntimeCodeHash: address(registry).codehash
            })
        );
        vm.startPrank(admin);
        sourceRegistry.grantRole(sourceRegistry.SOURCE_PROPOSER_ROLE(), address(registrar));
        sourceRegistry.revokeRole(sourceRegistry.SOURCE_PROPOSER_ROLE(), bootstrapProposer);
        vm.stopPrank();

        create2Deployer = new ProductionCreate2DeployerMock();
        approvedFactory = new ProductionApprovedFactoryMock();
        creationCode = type(ProductionFutureCustomFeeSourceMock).creationCode;
        creationCodeHash = keccak256(creationCode);
        sourceRuntimeCodeHash = keccak256(type(ProductionFutureCustomFeeSourceMock).runtimeCode);
        predictedSource = _predict(address(create2Deployer), CREATE2_SALT, creationCodeHash);
    }

    function test_fullFutureCustomAdmissionBecomesRegistrarEnumerableAndExecutable() public {
        (CustomRevenueApprovalStateV2 memory approval, ProtocolRevenueSourceConfigV1 memory source) = _authorize();

        vm.prank(launchAdmitter);
        registrar.proposeFutureCustom(_proposal(approval, source));
        assertEq(registrar.finalizedSourceCount(), 0);

        uint64 activationBlock = source.activationBlock;
        vm.roll(activationBlock);
        assertEq(create2Deployer.deploy(CREATE2_SALT, creationCode), predictedSource);
        vm.prank(activator);
        sourceRegistry.activateSource(source.sourceId);
        assertTrue(sourceRegistry.isExecutable(source.sourceId));
        assertEq(registrar.finalizedSourceCount(), 0);

        bytes32 activationBlockHash = keccak256("activation-block-hash");
        vm.roll(activationBlock + 1);
        vm.setBlockhash(activationBlock, activationBlockHash);
        ProgrammableCustomRevenueRegistryV2.LaunchObservationV2 memory observation =
            _observation(approval, activationBlock, activationBlockHash);
        vm.prank(launchRecorder);
        registry.observeLaunch(observation);

        CustomRevenueLaunchStateV2 memory observed = registry.revenueLaunch(LAUNCH_ID);
        assertEq(uint8(observed.status), uint8(CustomRevenueLaunchStatusV2.Observed));
        assertEq(observed.sourceId, source.sourceId);
        assertEq(observed.launchStampRouter, address(registry));
        assertEq(observed.sourceActivatedTotalClaimedBaseline, 0);
        assertFalse(registrar.isFinalizedExecutable(LAUNCH_ID));

        uint64 observedBlock = observed.observedAtBlock;
        uint64 confirmedHead = observedBlock + registry.MINIMUM_FINALITY_BLOCKS();
        bytes32 observedBlockHash = keccak256("observed-block-hash");
        bytes32 confirmedHeadHash = keccak256("confirmed-head-hash");
        vm.roll(confirmedHead + 1);
        vm.setBlockhash(observedBlock, observedBlockHash);
        vm.setBlockhash(confirmedHead, confirmedHeadHash);
        vm.prank(finalizer);
        registry.finalizeLaunch(
            ProgrammableCustomRevenueRegistryV2.LaunchFinalityProofV2({
                launchId: LAUNCH_ID,
                observedBlockNumber: observedBlock,
                observedBlockHash: observedBlockHash,
                confirmedHeadBlockNumber: confirmedHead,
                confirmedHeadBlockHash: confirmedHeadHash,
                finalityEvidenceHash: keccak256("finality-evidence")
            })
        );

        CustomRevenueLaunchStateV2 memory finalized = registry.revenueLaunch(LAUNCH_ID);
        assertEq(uint8(finalized.status), uint8(CustomRevenueLaunchStatusV2.Finalized));
        assertEq(finalized.launchStampBlockHash, observedBlockHash);
        registrar.confirmFinalizedLaunch(LAUNCH_ID);
        assertEq(registrar.finalizedSourceCount(), 1);
        assertEq(registrar.finalizedSourceIdAt(0), source.sourceId);
        assertTrue(registrar.isFinalizedExecutable(LAUNCH_ID));

        _assertFinalizedSourceClaimAndStatefulReceipt(source.sourceId);
    }

    function test_approvalCannotBindQuoteAssetWrongRateOrWrongRecipient() public {
        CustomRevenueApprovalStateV2 memory approval = _approvalTemplate();
        approval.asset = makeAddr("erc20");
        _expectSourcePolicyRevert(approval);

        approval = _approvalTemplate();
        approval.programmableFeeBps = 9;
        _expectSourcePolicyRevert(approval);

        approval = _approvalTemplate();
        approval.recipient = makeAddr("wrongRecipient");
        _expectSourcePolicyRevert(approval);
    }

    function test_observationRejectsStampDriftAfterExactApproval() public {
        (CustomRevenueApprovalStateV2 memory approval, ProtocolRevenueSourceConfigV1 memory source) = _authorize();
        vm.prank(launchAdmitter);
        registrar.proposeFutureCustom(_proposal(approval, source));
        vm.roll(source.activationBlock);
        create2Deployer.deploy(CREATE2_SALT, creationCode);
        vm.prank(activator);
        sourceRegistry.activateSource(source.sourceId);

        bytes32 activationBlockHash = keccak256("activation-block-hash");
        vm.roll(source.activationBlock + 1);
        vm.setBlockhash(source.activationBlock, activationBlockHash);
        ProgrammableCustomRevenueRegistryV2.LaunchObservationV2 memory observation =
            _observation(approval, source.activationBlock, activationBlockHash);
        observation.stamp.routePayloadHash = keccak256("unapproved-route");
        bytes32 actualStampHash = registry.computeLaunchStampHash(LAUNCH_ID, observation.stamp);

        vm.prank(launchRecorder);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRevenueRegistryV2.LaunchStampHashMismatch.selector,
                observation.stamp.stampHash,
                actualStampHash
            )
        );
        registry.observeLaunch(observation);
    }

    function test_observationRejectsWrongPoolManager() public {
        (CustomRevenueApprovalStateV2 memory approval, ProtocolRevenueSourceConfigV1 memory source) = _authorize();
        vm.prank(launchAdmitter);
        registrar.proposeFutureCustom(_proposal(approval, source));
        vm.roll(source.activationBlock);
        create2Deployer.deploy(CREATE2_SALT, creationCode);
        vm.prank(activator);
        sourceRegistry.activateSource(source.sourceId);

        bytes32 activationBlockHash = keccak256("activation-block-hash");
        vm.roll(source.activationBlock + 1);
        vm.setBlockhash(source.activationBlock, activationBlockHash);
        ProgrammableCustomRevenueRegistryV2.LaunchObservationV2 memory observation =
            _observation(approval, source.activationBlock, activationBlockHash);
        observation.stamp.poolManager = makeAddr("wrongPoolManager");
        observation.stamp.stampHash = registry.computeLaunchStampHash(LAUNCH_ID, observation.stamp);

        vm.prank(launchRecorder);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRevenueRegistryV2.InfrastructureBindingMismatch.selector, bytes32("pool-manager")
            )
        );
        registry.observeLaunch(observation);
    }

    function test_observationRejectsPreWorkerClaimHistory() public {
        (CustomRevenueApprovalStateV2 memory approval, ProtocolRevenueSourceConfigV1 memory source) = _authorize();
        vm.prank(launchAdmitter);
        registrar.proposeFutureCustom(_proposal(approval, source));
        vm.roll(source.activationBlock);
        create2Deployer.deploy(CREATE2_SALT, creationCode);
        vm.prank(activator);
        sourceRegistry.activateSource(source.sourceId);
        ProductionFutureCustomFeeSourceMock feeSource = ProductionFutureCustomFeeSourceMock(payable(predictedSource));
        feeSource.accrueNative{ value: 1 wei }();
        feeSource.claimProgrammableFees(address(0));

        bytes32 activationBlockHash = keccak256("activation-block-hash");
        vm.roll(source.activationBlock + 1);
        vm.setBlockhash(source.activationBlock, activationBlockHash);
        vm.prank(launchRecorder);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRevenueRegistryV2.SourceBindingMismatch.selector, bytes32("source-claimed-baseline")
            )
        );
        registry.observeLaunch(_observation(approval, source.activationBlock, activationBlockHash));
    }

    function test_onlySeparatedOperationalRolesCanAdvanceLifecycle() public {
        (CustomRevenueApprovalStateV2 memory approval,) = _approvalAndSource();
        approval.approvalBindingHash = registry.computeApprovalBindingHash(APPROVAL_ID, approval);
        vm.expectRevert();
        registry.authorizeApproval(APPROVAL_ID, approval);

        bytes32 finalizerRole = registry.FINALIZER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRevenueRegistryV2.IncompatibleOperationalRoles.selector, approver)
        );
        vm.prank(admin);
        registry.grantRole(finalizerRole, approver);
    }

    function _authorize()
        internal
        returns (CustomRevenueApprovalStateV2 memory approval, ProtocolRevenueSourceConfigV1 memory source)
    {
        (approval, source) = _approvalAndSource();
        approval.approvalBindingHash = registry.computeApprovalBindingHash(APPROVAL_ID, approval);
        vm.prank(approver);
        registry.authorizeApproval(APPROVAL_ID, approval);
    }

    function _approvalAndSource()
        internal
        view
        returns (CustomRevenueApprovalStateV2 memory approval, ProtocolRevenueSourceConfigV1 memory source)
    {
        approval = _approvalTemplate();
        source = ProtocolRevenueSourceConfigV1({
            sourceId: bytes32(0),
            source: approval.source,
            runtimeCodeHash: approval.sourceRuntimeCodeHash,
            asset: approval.asset,
            claimSelector: approval.claimSelector,
            recipient: approval.recipient,
            activationBlock: approval.activationBlock
        });
        source.sourceId = sourceRegistry.computeSourceId(source);
    }

    function _approvalTemplate() internal view returns (CustomRevenueApprovalStateV2 memory approval) {
        ProgrammableLaunchStampRecordV1 memory stamp = _stampTemplate();
        stamp.stampHash = registry.computeLaunchStampHash(LAUNCH_ID, stamp);
        approval = CustomRevenueApprovalStateV2({
            launchId: LAUNCH_ID,
            launchWallet: launchWallet,
            launchClassId: registry.CUSTOM_LAUNCH_CLASS_ID(),
            approvalBindingHash: bytes32(0),
            registrationBindingHash: REGISTRATION_BINDING,
            expectedLaunchStampHash: stamp.stampHash,
            approvedFactory: address(approvedFactory),
            approvedFactoryRuntimeCodeHash: address(approvedFactory).codehash,
            create2Deployer: address(create2Deployer),
            create2DeployerRuntimeCodeHash: address(create2Deployer).codehash,
            create2Salt: CREATE2_SALT,
            creationCodeHash: creationCodeHash,
            templateCommitment: TEMPLATE_COMMITMENT,
            source: predictedSource,
            sourceRuntimeCodeHash: sourceRuntimeCodeHash,
            asset: address(0),
            claimSelector: IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector,
            standardInterfaceId: type(IProgrammableProtocolFeeSourceV1).interfaceId,
            recipient: REWARD_WALLET,
            programmableFeeBps: 10,
            activationBlock: uint64(block.number + 64),
            validAfterBlock: uint64(block.number),
            expiresAtBlock: uint64(block.number + 10_000),
            evidenceHash: keccak256("approval-evidence"),
            consumed: false
        });
    }

    function _proposal(CustomRevenueApprovalStateV2 memory approval, ProtocolRevenueSourceConfigV1 memory source)
        internal
        pure
        returns (ProtocolRevenueCustomLaunchRegistrarV1.FutureCustomProposalV1 memory)
    {
        return ProtocolRevenueCustomLaunchRegistrarV1.FutureCustomProposalV1({
            launchId: approval.launchId,
            approvalId: APPROVAL_ID,
            launchWallet: approval.launchWallet,
            approvalBindingHash: approval.approvalBindingHash,
            registrationBindingHash: approval.registrationBindingHash,
            expectedLaunchStampHash: approval.expectedLaunchStampHash,
            approvedFactory: approval.approvedFactory,
            approvedFactoryRuntimeCodeHash: approval.approvedFactoryRuntimeCodeHash,
            create2Deployer: approval.create2Deployer,
            create2DeployerRuntimeCodeHash: approval.create2DeployerRuntimeCodeHash,
            create2Salt: approval.create2Salt,
            creationCodeHash: approval.creationCodeHash,
            templateCommitment: approval.templateCommitment,
            source: source
        });
    }

    function _observation(CustomRevenueApprovalStateV2 memory approval, uint64 activationBlock, bytes32 blockHash)
        internal
        view
        returns (ProgrammableCustomRevenueRegistryV2.LaunchObservationV2 memory)
    {
        ProgrammableLaunchStampRecordV1 memory stamp = _stampTemplate();
        stamp.stampHash = approval.expectedLaunchStampHash;
        return ProgrammableCustomRevenueRegistryV2.LaunchObservationV2({
            launchId: LAUNCH_ID,
            approvalId: APPROVAL_ID,
            stamp: stamp,
            sourceActivation: ProgrammableCustomRevenueRegistryV2.SourceActivationEvidenceV2({
                blockNumber: activationBlock,
                blockHash: blockHash,
                transactionHash: keccak256("source-activation-transaction"),
                transactionIndex: 1,
                logIndex: 3,
                totalClaimedBaseline: 0
            })
        });
    }

    function _stampTemplate() internal view returns (ProgrammableLaunchStampRecordV1 memory) {
        return ProgrammableLaunchStampRecordV1({
            kind: 1,
            launchWallet: launchWallet,
            token: token,
            hook: predictedSource,
            poolManager: address(poolManager),
            poolId: keccak256("pool-id"),
            poolKeyHash: keccak256("pool-key"),
            componentSetHash: keccak256("component-set"),
            routePayloadHash: keccak256("route-payload"),
            routeLauncher: address(approvedFactory),
            routeLauncherRuntimeCodeHash: address(approvedFactory).codehash,
            expectedResultHash: keccak256("expected-result"),
            permitDigest: keccak256("permit"),
            stampHash: bytes32(0)
        });
    }

    function _expectSourcePolicyRevert(CustomRevenueApprovalStateV2 memory approval) internal {
        approval.approvalBindingHash = registry.computeApprovalBindingHash(APPROVAL_ID, approval);
        vm.prank(approver);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRevenueRegistryV2.SourceBindingMismatch.selector, bytes32("source-policy")
            )
        );
        registry.authorizeApproval(APPROVAL_ID, approval);
    }

    function _assertFinalizedSourceClaimAndStatefulReceipt(bytes32 sourceId) internal {
        uint256 recorderDeploymentNonce = vm.getNonce(address(this));
        address predictedExecutor = vm.computeCreateAddress(address(this), recorderDeploymentNonce + 1);
        ProtocolRevenueCustomClaimRecorderV1 claimRecorder =
            new ProtocolRevenueCustomClaimRecorderV1(predictedExecutor, keccak256("custom-v2-activation"));
        ProtocolRevenueClaimExecutorV1 claimExecutor = new ProtocolRevenueClaimExecutorV1(
            address(sourceRegistry),
            sourceRegistry.collector(),
            600_000,
            address(claimRecorder),
            address(claimRecorder).codehash,
            address(registrar),
            address(registrar).codehash
        );
        assertEq(address(claimExecutor), predictedExecutor);
        ProductionFutureCustomFeeSourceMock(payable(predictedSource)).accrueNative{ value: 0.27 ether }();
        bytes32[] memory sourceIds = new bytes32[](1);
        sourceIds[0] = sourceId;
        bytes32 claimRecordHash = claimExecutor.claimBatchAndRecord(uint64(block.timestamp / 1 days), sourceIds);
        (
            bool exists,
            uint64 cycleId,
            uint256 totalClaimedWei,
            bytes32 sourceTotalsHash,
            bytes32 claimBatchCommitment,
            bytes32 sourceBindingHash,
            uint256 claimBlockNumber
        ) = claimRecorder.claimRecord(claimRecordHash);
        assertTrue(exists);
        assertEq(cycleId, uint64(block.timestamp / 1 days));
        assertEq(totalClaimedWei, 0.27 ether);
        assertNotEq(sourceTotalsHash, bytes32(0));
        assertNotEq(claimBatchCommitment, bytes32(0));
        assertEq(sourceBindingHash, claimRecorder.sourceBindingHash());
        assertEq(claimBlockNumber, block.number);
        assertEq(REWARD_WALLET.balance, 0.27 ether);
    }

    function _predict(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
