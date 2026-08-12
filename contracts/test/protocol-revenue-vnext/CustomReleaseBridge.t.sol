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
import { ProtocolRevenueSourceRegistryV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueSourceRegistryV1.sol";
import {
    CustomRevenueApprovalStateV2,
    CustomRevenueLaunchStateV2,
    CustomRevenueLaunchStatusV2,
    IProgrammableCustomRevenueRegistryV2,
    IProgrammableLaunchStampRouterV1,
    ProgrammableLaunchStampRecordV1
} from "../../src/protocol-revenue-vnext/custom/IProgrammableCustomRevenueReleaseV2.sol";
import {
    ProtocolRevenueCustomLaunchRegistrarV1
} from "../../src/protocol-revenue-vnext/custom/ProtocolRevenueCustomLaunchRegistrarV1.sol";

contract FutureCustomFeeSourceMock is ProgrammableProtocolFeeSourceBaseV1 {
    using Address for address payable;

    uint16 private _feeBps = 10;

    receive() external payable { }

    function programmableFeeBps(address asset) external view returns (uint16) {
        if (asset != address(0)) revert UnsupportedProtocolRevenueAsset(asset);
        return _feeBps;
    }

    function setProgrammableFeeBps(uint16 feeBps) external {
        _feeBps = feeBps;
    }

    function accrueNative() external payable {
        _accrueProgrammableFee(address(0), msg.value);
    }

    function claimProgrammableFees(address asset) external returns (uint256 amount) {
        amount = _consumeProgrammableFees(asset);
        if (amount != 0) payable(PROGRAMMABLE_REWARD_WALLET).sendValue(amount);
    }
}

contract Create2DeployerMock {
    function deploy(bytes32 salt, bytes memory creationCode) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        require(deployed != address(0), "CREATE2_FAILED");
    }
}

contract ApprovedFactoryMock { }

contract CustomRevenueRegistryV2Mock is IProgrammableCustomRevenueRegistryV2 {
    uint256 public constant CHAIN_ID = 1;
    uint64 public immutable REGISTRY_GENERATION;
    uint64 public constant MINIMUM_FINALITY_BLOCKS = 64;

    mapping(bytes32 approvalId => CustomRevenueApprovalStateV2 state) private _approvals;
    mapping(bytes32 launchId => CustomRevenueLaunchStateV2 state) private _launches;

    constructor(uint64 generation) {
        REGISTRY_GENERATION = generation;
    }

    function setApproval(bytes32 approvalId, CustomRevenueApprovalStateV2 calldata state) external {
        _approvals[approvalId] = state;
    }

    function setRevenueLaunch(bytes32 launchId, CustomRevenueLaunchStateV2 calldata state) external {
        _launches[launchId] = state;
    }

    function approvalState(bytes32 approvalId) external view returns (CustomRevenueApprovalStateV2 memory state) {
        return _approvals[approvalId];
    }

    function revenueLaunch(bytes32 launchId) external view returns (CustomRevenueLaunchStateV2 memory state) {
        return _launches[launchId];
    }
}

contract LaunchStampRouterMock is IProgrammableLaunchStampRouterV1 {
    uint256 public constant CHAIN_ID = 1;

    mapping(bytes32 launchId => ProgrammableLaunchStampRecordV1 record) private _stamps;
    mapping(address component => bytes32 launchId) private _launchByComponent;
    mapping(address component => bytes32 runtimeCodeHash) private _runtimeByComponent;
    mapping(address component => bytes32 stampHash) private _stampHashByComponent;

    function setStamp(
        bytes32 launchId,
        ProgrammableLaunchStampRecordV1 calldata record,
        address component,
        bytes32 runtimeCodeHash
    ) external {
        _stamps[launchId] = record;
        _launchByComponent[component] = launchId;
        _runtimeByComponent[component] = runtimeCodeHash;
        _stampHashByComponent[component] = record.stampHash;
    }

    function launchStamp(bytes32 launchId) external view returns (ProgrammableLaunchStampRecordV1 memory record) {
        return _stamps[launchId];
    }

    function launchIdByComponent(address component) external view returns (bytes32 launchId) {
        return _launchByComponent[component];
    }

    function componentRuntimeCodeHash(address component) external view returns (bytes32 runtimeCodeHash) {
        return _runtimeByComponent[component];
    }

    function stampProof(address component) external view returns (bytes32 launchId, bytes32 stampHash) {
        return (_launchByComponent[component], _stampHashByComponent[component]);
    }
}

contract ProtocolRevenueCustomReleaseBridgeTest is Test {
    address internal constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    address internal admin = makeAddr("admin");
    address internal bootstrapProposer = makeAddr("bootstrapProposer");
    address internal activator = makeAddr("activator");
    address internal quarantiner = makeAddr("quarantiner");
    address internal launchAdmitter = makeAddr("launchAdmitter");
    address internal launchWallet = makeAddr("launchWallet");

    bytes32 internal constant LAUNCH_ID = keccak256("future-custom-launch");
    bytes32 internal constant APPROVAL_ID = keccak256("future-custom-approval");
    bytes32 internal constant APPROVAL_BINDING = keccak256("approval-binding");
    bytes32 internal constant REGISTRATION_BINDING = keccak256("registration-binding");
    bytes32 internal constant STAMP_HASH = keccak256("launch-stamp");
    bytes32 internal constant TEMPLATE_COMMITMENT = keccak256("approved-template");
    bytes32 internal constant CREATE2_SALT = keccak256("future-source-salt");
    bytes32 internal constant FIELD_SOURCE_ACTIVATION_BASELINE = "source-activation-baseline";
    bytes32 internal constant FIELD_DEPLOYMENT_TEMPLATE = "deployment-template";
    bytes32 internal constant FIELD_CUSTOM_REGISTRY_V2_POLICY = "custom-registry-v2-policy";
    bytes32 internal constant FIELD_CREATE2_PREDICTION = "create2-prediction";
    bytes32 internal constant FIELD_DEPLOYMENT_RUNTIME = "deployment-runtime-code-hash";
    bytes32 internal constant FIELD_LAUNCH_STAMP_HASH = "launch-stamp-hash";

    ProtocolRevenueSourceRegistryV1 internal sourceRegistry;
    CustomRevenueRegistryV2Mock internal customRegistry;
    LaunchStampRouterMock internal launchStampRouter;
    Create2DeployerMock internal create2Deployer;
    ApprovedFactoryMock internal approvedFactory;
    ProtocolRevenueCustomLaunchRegistrarV1 internal registrar;

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
        customRegistry = new CustomRevenueRegistryV2Mock(2);
        launchStampRouter = new LaunchStampRouterMock();
        create2Deployer = new Create2DeployerMock();
        approvedFactory = new ApprovedFactoryMock();

        registrar = new ProtocolRevenueCustomLaunchRegistrarV1(
            ProtocolRevenueCustomLaunchRegistrarV1.RegistrarConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: admin,
                initialLaunchAdmitter: launchAdmitter,
                sourceRegistry: address(sourceRegistry),
                sourceRegistryRuntimeCodeHash: address(sourceRegistry).codehash,
                customRegistryV2: address(customRegistry),
                customRegistryV2RuntimeCodeHash: address(customRegistry).codehash,
                launchStampRouter: address(launchStampRouter),
                launchStampRouterRuntimeCodeHash: address(launchStampRouter).codehash
            })
        );

        vm.startPrank(admin);
        sourceRegistry.grantRole(sourceRegistry.SOURCE_PROPOSER_ROLE(), address(registrar));
        sourceRegistry.revokeRole(sourceRegistry.SOURCE_PROPOSER_ROLE(), bootstrapProposer);
        vm.stopPrank();

        creationCode = type(FutureCustomFeeSourceMock).creationCode;
        creationCodeHash = keccak256(creationCode);
        sourceRuntimeCodeHash = keccak256(type(FutureCustomFeeSourceMock).runtimeCode);
        predictedSource = _predict(address(create2Deployer), CREATE2_SALT, creationCodeHash);
        customRegistry.setApproval(APPROVAL_ID, _approval());
        vm.deal(REWARD_WALLET, 0);
    }

    function test_onlyFinalizedExactCustomBindingEntersWorkerEnumeration() public {
        ProtocolRevenueSourceConfigV1 memory source = _sourceConfig();
        _propose(source);
        assertEq(registrar.finalizedSourceCount(), 0);

        vm.roll(source.activationBlock);
        assertEq(create2Deployer.deploy(CREATE2_SALT, creationCode), predictedSource);
        vm.prank(activator);
        sourceRegistry.activateSource(source.sourceId);

        // Independent activation is not worker eligibility.
        assertTrue(sourceRegistry.isExecutable(source.sourceId));
        assertEq(registrar.finalizedSourceCount(), 0);
        assertFalse(registrar.isFinalizedExecutable(LAUNCH_ID));

        uint64 stampBlock = uint64(block.number + 1);
        vm.roll(stampBlock + 64);
        customRegistry.setRevenueLaunch(LAUNCH_ID, _finalized(source, source.activationBlock, stampBlock));
        launchStampRouter.setStamp(LAUNCH_ID, _stamp(), predictedSource, sourceRuntimeCodeHash);

        registrar.confirmFinalizedLaunch(LAUNCH_ID);
        assertEq(registrar.finalizedSourceCount(), 1);
        assertEq(registrar.finalizedLaunchIdAt(0), LAUNCH_ID);
        assertEq(registrar.finalizedSourceIdAt(0), source.sourceId);
        assertTrue(registrar.isFinalizedExecutable(LAUNCH_ID));
    }

    function test_rejectsFinalRecordWithNonzeroActivationCounterBaseline() public {
        ProtocolRevenueSourceConfigV1 memory source = _deployActivateAndPrepare();
        uint64 stampBlock = uint64(block.number + 1);
        vm.roll(stampBlock + 64);
        CustomRevenueLaunchStateV2 memory finalized = _finalized(source, source.activationBlock, stampBlock);
        finalized.sourceActivatedTotalClaimedBaseline = 1;
        customRegistry.setRevenueLaunch(LAUNCH_ID, finalized);
        launchStampRouter.setStamp(LAUNCH_ID, _stamp(), predictedSource, sourceRuntimeCodeHash);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueCustomLaunchRegistrarV1.FinalityBindingMismatch.selector,
                FIELD_SOURCE_ACTIVATION_BASELINE
            )
        );
        registrar.confirmFinalizedLaunch(LAUNCH_ID);
    }

    function test_rejectsChangedApprovedFactoryOrTemplate() public {
        ProtocolRevenueSourceConfigV1 memory source = _deployActivateAndPrepare();
        uint64 stampBlock = uint64(block.number + 1);
        vm.roll(stampBlock + 64);
        CustomRevenueLaunchStateV2 memory finalized = _finalized(source, source.activationBlock, stampBlock);
        finalized.templateCommitment = keccak256("wrong-template");
        customRegistry.setRevenueLaunch(LAUNCH_ID, finalized);
        launchStampRouter.setStamp(LAUNCH_ID, _stamp(), predictedSource, sourceRuntimeCodeHash);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueCustomLaunchRegistrarV1.FinalityBindingMismatch.selector, FIELD_DEPLOYMENT_TEMPLATE
            )
        );
        registrar.confirmFinalizedLaunch(LAUNCH_ID);
    }

    function test_rejectsActualApprovedFactoryRuntimeDriftAtFinalization() public {
        ProtocolRevenueSourceConfigV1 memory source = _deployActivateAndPrepare();
        uint64 stampBlock = uint64(block.number + 1);
        vm.roll(stampBlock + 64);
        customRegistry.setRevenueLaunch(LAUNCH_ID, _finalized(source, source.activationBlock, stampBlock));
        launchStampRouter.setStamp(LAUNCH_ID, _stamp(), predictedSource, sourceRuntimeCodeHash);
        vm.etch(address(approvedFactory), hex"00");

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueCustomLaunchRegistrarV1.InfrastructureBindingMismatch.selector, FIELD_DEPLOYMENT_RUNTIME
            )
        );
        registrar.confirmFinalizedLaunch(LAUNCH_ID);
    }

    function test_quarantineStopsExecutionButDoesNotRemoveLifetimeObservationIdentity() public {
        ProtocolRevenueSourceConfigV1 memory source = _finalizeOne();
        vm.prank(quarantiner);
        sourceRegistry.quarantineSource(source.sourceId, keccak256("incident"));

        assertFalse(registrar.isFinalizedExecutable(LAUNCH_ID));
        assertEq(registrar.finalizedSourceCount(), 1);
        assertEq(registrar.finalizedSourceIdAt(0), source.sourceId);

        FutureCustomFeeSourceMock feeSource = FutureCustomFeeSourceMock(payable(predictedSource));
        feeSource.accrueNative{ value: 1 ether }();
        feeSource.claimProgrammableFees(address(0));
        assertEq(feeSource.totalProgrammableFeesClaimed(address(0)), 1 ether);
        assertEq(REWARD_WALLET.balance, 1 ether);
    }

    function test_currentEligibilityRechecksStampIndexesAndFeeRate() public {
        _finalizeOne();
        ProgrammableLaunchStampRecordV1 memory changed = _stamp();
        changed.routeLauncher = makeAddr("wrong-factory");
        launchStampRouter.setStamp(LAUNCH_ID, changed, predictedSource, sourceRuntimeCodeHash);
        assertFalse(registrar.isFinalizedExecutable(LAUNCH_ID));

        launchStampRouter.setStamp(LAUNCH_ID, _stamp(), predictedSource, sourceRuntimeCodeHash);
        FutureCustomFeeSourceMock(payable(predictedSource)).setProgrammableFeeBps(9);
        assertFalse(registrar.isFinalizedExecutable(LAUNCH_ID));
    }

    function test_registryV1GenerationCannotBeUsedAsCustomV2Truth() public {
        CustomRevenueRegistryV2Mock v1Shape = new CustomRevenueRegistryV2Mock(1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueCustomLaunchRegistrarV1.InfrastructureBindingMismatch.selector,
                FIELD_CUSTOM_REGISTRY_V2_POLICY
            )
        );
        new ProtocolRevenueCustomLaunchRegistrarV1(
            ProtocolRevenueCustomLaunchRegistrarV1.RegistrarConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: admin,
                initialLaunchAdmitter: launchAdmitter,
                sourceRegistry: address(sourceRegistry),
                sourceRegistryRuntimeCodeHash: address(sourceRegistry).codehash,
                customRegistryV2: address(v1Shape),
                customRegistryV2RuntimeCodeHash: address(v1Shape).codehash,
                launchStampRouter: address(launchStampRouter),
                launchStampRouterRuntimeCodeHash: address(launchStampRouter).codehash
            })
        );
    }

    function test_rejectsNonCREATE2SourcePrediction() public {
        ProtocolRevenueCustomLaunchRegistrarV1.FutureCustomProposalV1 memory proposal = _proposal(_sourceConfig());
        proposal.source.source = makeAddr("not-predicted");
        proposal.source.sourceId = sourceRegistry.computeSourceId(proposal.source);

        vm.prank(launchAdmitter);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueCustomLaunchRegistrarV1.SourceBindingMismatch.selector, FIELD_CREATE2_PREDICTION
            )
        );
        registrar.proposeFutureCustom(proposal);
    }

    function test_rejectsProposalWhoseLaunchStampWasNotApproved() public {
        ProtocolRevenueCustomLaunchRegistrarV1.FutureCustomProposalV1 memory proposal = _proposal(_sourceConfig());
        proposal.expectedLaunchStampHash = keccak256("unapproved-launch-stamp");

        vm.prank(launchAdmitter);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueCustomLaunchRegistrarV1.ApprovalBindingMismatch.selector, FIELD_LAUNCH_STAMP_HASH
            )
        );
        registrar.proposeFutureCustom(proposal);
    }

    function _finalizeOne() internal returns (ProtocolRevenueSourceConfigV1 memory source) {
        source = _deployActivateAndPrepare();
        uint64 stampBlock = uint64(block.number + 1);
        vm.roll(stampBlock + 64);
        customRegistry.setRevenueLaunch(LAUNCH_ID, _finalized(source, source.activationBlock, stampBlock));
        launchStampRouter.setStamp(LAUNCH_ID, _stamp(), predictedSource, sourceRuntimeCodeHash);
        registrar.confirmFinalizedLaunch(LAUNCH_ID);
    }

    function _deployActivateAndPrepare() internal returns (ProtocolRevenueSourceConfigV1 memory source) {
        source = _sourceConfig();
        _propose(source);
        vm.roll(source.activationBlock);
        create2Deployer.deploy(CREATE2_SALT, creationCode);
        vm.prank(activator);
        sourceRegistry.activateSource(source.sourceId);
    }

    function _propose(ProtocolRevenueSourceConfigV1 memory source) internal {
        vm.prank(launchAdmitter);
        registrar.proposeFutureCustom(_proposal(source));
    }

    function _sourceConfig() internal view returns (ProtocolRevenueSourceConfigV1 memory source) {
        source = ProtocolRevenueSourceConfigV1({
            sourceId: bytes32(0),
            source: predictedSource,
            runtimeCodeHash: sourceRuntimeCodeHash,
            asset: address(0),
            claimSelector: IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector,
            recipient: REWARD_WALLET,
            activationBlock: uint64(block.number + 64)
        });
        source.sourceId = sourceRegistry.computeSourceId(source);
    }

    function _proposal(ProtocolRevenueSourceConfigV1 memory source)
        internal
        view
        returns (ProtocolRevenueCustomLaunchRegistrarV1.FutureCustomProposalV1 memory)
    {
        return ProtocolRevenueCustomLaunchRegistrarV1.FutureCustomProposalV1({
            launchId: LAUNCH_ID,
            approvalId: APPROVAL_ID,
            launchWallet: launchWallet,
            approvalBindingHash: APPROVAL_BINDING,
            registrationBindingHash: REGISTRATION_BINDING,
            expectedLaunchStampHash: STAMP_HASH,
            approvedFactory: address(approvedFactory),
            approvedFactoryRuntimeCodeHash: address(approvedFactory).codehash,
            create2Deployer: address(create2Deployer),
            create2DeployerRuntimeCodeHash: address(create2Deployer).codehash,
            create2Salt: CREATE2_SALT,
            creationCodeHash: creationCodeHash,
            templateCommitment: TEMPLATE_COMMITMENT,
            source: source
        });
    }

    function _approval() internal view returns (CustomRevenueApprovalStateV2 memory) {
        return CustomRevenueApprovalStateV2({
            launchId: LAUNCH_ID,
            launchWallet: launchWallet,
            launchClassId: registrar.CUSTOM_LAUNCH_CLASS_ID(),
            approvalBindingHash: APPROVAL_BINDING,
            registrationBindingHash: REGISTRATION_BINDING,
            expectedLaunchStampHash: STAMP_HASH,
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
            claimSelector: registrar.CLAIM_SELECTOR(),
            standardInterfaceId: registrar.STANDARD_SOURCE_INTERFACE_ID(),
            recipient: REWARD_WALLET,
            programmableFeeBps: 10,
            activationBlock: uint64(block.number + 64),
            validAfterBlock: uint64(block.number),
            expiresAtBlock: uint64(block.number + 10_000),
            evidenceHash: keccak256("approval-evidence"),
            consumed: false
        });
    }

    function _finalized(ProtocolRevenueSourceConfigV1 memory source, uint64 activatedAtBlock, uint64 stampBlock)
        internal
        view
        returns (CustomRevenueLaunchStateV2 memory)
    {
        return CustomRevenueLaunchStateV2({
            status: CustomRevenueLaunchStatusV2.Finalized,
            observedAtBlock: stampBlock,
            finalizedAtBlock: stampBlock + 64,
            approvalId: APPROVAL_ID,
            launchClassId: registrar.CUSTOM_LAUNCH_CLASS_ID(),
            approvalBindingHash: APPROVAL_BINDING,
            registrationBindingHash: REGISTRATION_BINDING,
            finalityEvidenceHash: keccak256("finality-evidence"),
            launchWallet: launchWallet,
            approvedFactory: address(approvedFactory),
            approvedFactoryRuntimeCodeHash: address(approvedFactory).codehash,
            create2Deployer: address(create2Deployer),
            create2DeployerRuntimeCodeHash: address(create2Deployer).codehash,
            create2Salt: CREATE2_SALT,
            creationCodeHash: creationCodeHash,
            templateCommitment: TEMPLATE_COMMITMENT,
            sourceRegistry: address(sourceRegistry),
            sourceRegistryRuntimeCodeHash: address(sourceRegistry).codehash,
            sourceId: source.sourceId,
            source: source.source,
            sourceRuntimeCodeHash: source.runtimeCodeHash,
            asset: address(0),
            claimSelector: registrar.CLAIM_SELECTOR(),
            standardInterfaceId: registrar.STANDARD_SOURCE_INTERFACE_ID(),
            recipient: REWARD_WALLET,
            programmableFeeBps: 10,
            activationBlock: source.activationBlock,
            sourceActivatedAtBlock: activatedAtBlock,
            sourceActivatedAtBlockHash: keccak256("activation-block"),
            sourceActivationTransactionHash: keccak256("activation-transaction"),
            sourceActivationTransactionIndex: 1,
            sourceActivationLogIndex: 3,
            sourceActivatedTotalClaimedBaseline: 0,
            launchStampRouter: address(launchStampRouter),
            launchStampRouterRuntimeCodeHash: address(launchStampRouter).codehash,
            launchStampHash: STAMP_HASH,
            launchStampBlockNumber: stampBlock,
            launchStampBlockHash: keccak256("stamp-block")
        });
    }

    function _stamp() internal returns (ProgrammableLaunchStampRecordV1 memory) {
        return ProgrammableLaunchStampRecordV1({
            kind: 1,
            launchWallet: launchWallet,
            token: makeAddr("token"),
            hook: predictedSource,
            poolManager: makeAddr("poolManager"),
            poolId: keccak256("pool"),
            poolKeyHash: keccak256("pool-key"),
            componentSetHash: keccak256("components"),
            routePayloadHash: keccak256("route"),
            routeLauncher: address(approvedFactory),
            routeLauncherRuntimeCodeHash: address(approvedFactory).codehash,
            expectedResultHash: keccak256("result"),
            permitDigest: keccak256("permit"),
            stampHash: STAMP_HASH
        });
    }

    function _predict(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
