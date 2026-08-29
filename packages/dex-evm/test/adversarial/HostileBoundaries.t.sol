// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { CoreV1 } from "../../src/core/CoreV1.sol";
import { DomainVaultV1 } from "../../src/core/DomainVaultV1.sol";
import { EngineRevisionDescriptorV1 } from "../../src/core/NativeIdentityV1.sol";
import {
    OpaqueEngineRequestV1,
    OpaqueEngineResponseV1,
    ReturnOnlyEngineLimitsV1
} from "../../src/interfaces/IReturnOnlyEngineV1.sol";
import { OpaqueStateEngineV1 } from "../../src/reference-engines/OpaqueStateEngineV1.sol";
import { StrictMeasuredERC20ProfileV1 } from "../../src/profiles/StrictMeasuredERC20ProfileV1.sol";
import { CoreTestFixtures } from "../helpers/CoreTestFixtures.sol";
import {
    AlternateEntryCodeOnlyEngineMock,
    EntryCodeOnlyEngineMock,
    ProxyShapedEntryEngineMock
} from "../mocks/EngineCodePolicyMocks.sol";
import {
    FalseReturnERC20Mock,
    FeeOnTransferERC20Mock,
    NoReturnERC20Mock,
    OverDebitERC20Mock,
    OversizedReturnERC20Mock,
    StrictERC20Mock
} from "../mocks/MockERC20s.sol";
import {
    ForwardingNativeRecipientMock,
    NativeSinkMock,
    OversizedReturnNativeRecipientMock,
    RevertingNativeRecipientMock
} from "../mocks/NativeRecipients.sol";
import { VaultControllerHarness } from "../mocks/VaultControllerHarness.sol";

interface IHostileTokenFixture {
    function mint(address account, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract HostileBoundariesTest is Test {
    bytes32 internal constant DOMAIN_REVISION_ID = keccak256("domain revision");
    bytes32 internal constant NATIVE_PROFILE = keccak256("programmable.dex.evm.asset-profile.native-eth-strict.v1");
    bytes32 internal constant ERC20_PROFILE = keccak256("programmable.dex.evm.asset-profile.erc20-strict-measured.v1");

    VaultControllerHarness internal controller;
    address internal source;

    function setUp() external {
        controller = new VaultControllerHarness();
        source = makeAddr("hostile token victim");
    }

    /// Threat: actor=false token; authority=return value; pre=1,000/0; attempt=pull 100; expect=revert; post=1,000/0.
    function test_falseReturnTokenCannotCreateCreditOrLiability() external {
        FalseReturnERC20Mock token = new FalseReturnERC20Mock();
        DomainVaultV1 vault = _prepareToken(IHostileTokenFixture(address(token)), keccak256("false token"));

        vm.expectRevert();
        controller.pullERC20(vault, source, 100);
        _assertNoTokenMovement(IHostileTokenFixture(address(token)), vault);
    }

    /// Threat: actor=empty-return token; authority=transfer ABI; pre=1,000/0; attempt=pull 100; expect=revert;
    /// post=1,000/0.
    function test_noReturnTokenFailsClosedAndRollsBackMovement() external {
        NoReturnERC20Mock token = new NoReturnERC20Mock();
        DomainVaultV1 vault = _prepareToken(IHostileTokenFixture(address(token)), keccak256("no return token"));

        vm.expectRevert();
        controller.pullERC20(vault, source, 100);
        _assertNoTokenMovement(IHostileTokenFixture(address(token)), vault);
    }

    /// Threat: actor=tax token; authority=credit delta; pre=1,000/0; attempt=credit 99 of 100; expect=revert;
    /// post=1,000/0.
    function test_feeOnTransferCannotUndercreditDestination() external {
        FeeOnTransferERC20Mock token = new FeeOnTransferERC20Mock();
        DomainVaultV1 vault = _prepareToken(IHostileTokenFixture(address(token)), keccak256("fee token"));

        vm.expectRevert(
            abi.encodeWithSelector(StrictMeasuredERC20ProfileV1.DestinationCreditMismatch.selector, 100, 99)
        );
        controller.pullERC20(vault, source, 100);
        _assertNoTokenMovement(IHostileTokenFixture(address(token)), vault);
    }

    /// Threat: actor=over-debit token; authority=debit delta; pre=1,000/0; attempt=debit 101; expect=revert;
    /// post=1,000/0.
    function test_overDebitTokenCannotConsumeBeyondRequestedAmount() external {
        OverDebitERC20Mock token = new OverDebitERC20Mock();
        DomainVaultV1 vault = _prepareToken(IHostileTokenFixture(address(token)), keccak256("over debit token"));

        vm.expectRevert(abi.encodeWithSelector(StrictMeasuredERC20ProfileV1.SourceDebitMismatch.selector, 100, 101));
        controller.pullERC20(vault, source, 100);
        _assertNoTokenMovement(IHostileTokenFixture(address(token)), vault);
    }

    /// Threat: actor=returndata token; authority=return bytes; pre=1,000/0; attempt=return 64 bytes; expect=revert;
    /// post=1,000/0.
    function test_oversizedTokenReturnDataIsNotCopiedAndMovementRollsBack() external {
        OversizedReturnERC20Mock token = new OversizedReturnERC20Mock();
        DomainVaultV1 vault = _prepareToken(IHostileTokenFixture(address(token)), keccak256("oversized token"));

        vm.expectRevert();
        controller.pullERC20(vault, source, 100);
        _assertNoTokenMovement(IHostileTokenFixture(address(token)), vault);
    }

    /// Threat: actor=token deployer; authority=entry code; pre=hash pinned; attempt=replace code; expect=revert;
    /// post=no movement.
    function test_tokenRuntimeMutationInvalidatesVaultBeforeMovement() external {
        StrictERC20Mock token = new StrictERC20Mock();
        DomainVaultV1 vault = _prepareToken(IHostileTokenFixture(address(token)), keccak256("runtime mutation"));
        bytes32 expected = address(token).codehash;
        vm.etch(address(token), hex"00");
        bytes32 actual = address(token).codehash;

        vm.expectRevert(
            abi.encodeWithSelector(DomainVaultV1.NativeAssetRuntimeChanged.selector, address(token), expected, actual)
        );
        controller.pullERC20(vault, source, 100);
    }

    /// Threat: actor=forwarder; authority=fallback; pre=vault 10 ETH; attempt=forward 2; expect=revert; post=vault 10,
    /// sinks 0.
    function test_nativeRecipientForwardingCannotFakeSpendableCredit() external {
        DomainVaultV1 vault = _deployNativeVault(keccak256("forwarding recipient"));
        NativeSinkMock sink = new NativeSinkMock();
        ForwardingNativeRecipientMock forwarder = new ForwardingNativeRecipientMock(payable(address(sink)));
        vm.deal(address(vault), 10 ether);

        vm.expectRevert();
        controller.pushNative(vault, payable(address(forwarder)), 2 ether);
        assertEq(address(vault).balance, 10 ether, "vault debit survived rollback");
        assertEq(address(forwarder).balance, 0, "forwarder retained partial credit");
        assertEq(address(sink).balance, 0, "sink retained forwarded credit");
    }

    /// Threat: actor=native recipient; authority=fallback; pre=vault 10 ETH; attempt=revert/257 bytes; expect=revert;
    /// post=10 ETH.
    function test_nativeRevertAndOversizedReturnAreBoundedAndAtomic() external {
        DomainVaultV1 vault = _deployNativeVault(keccak256("native grief"));
        RevertingNativeRecipientMock reverter = new RevertingNativeRecipientMock();
        OversizedReturnNativeRecipientMock oversized = new OversizedReturnNativeRecipientMock();
        vm.deal(address(vault), 10 ether);

        vm.expectRevert();
        controller.pushNative(vault, payable(address(reverter)), 1 ether);
        assertEq(address(vault).balance, 10 ether);

        vm.expectRevert();
        controller.pushNative(vault, payable(address(oversized)), 1 ether);
        assertEq(address(vault).balance, 10 ether);
        assertEq(address(oversized).balance, 0);
    }

    /// Threat: actor=Engine deployer; authority=entry code; pre=revision pinned; attempt=replace code; expect=reject;
    /// post=no Market.
    function test_engineRuntimeChangeInvalidatesRevisionAndMarketUse() external {
        CoreV1 core = new CoreV1(CoreTestFixtures.CONSTITUTION_ID, CoreTestFixtures.COLLECTOR);
        EntryCodeOnlyEngineMock engine = new EntryCodeOnlyEngineMock();
        EngineRevisionDescriptorV1 memory descriptor = CoreTestFixtures.engineDescriptor(core, address(engine));
        bytes32 revisionId = core.registerEngineRevision(descriptor);

        AlternateEntryCodeOnlyEngineMock alternate = new AlternateEntryCodeOnlyEngineMock();
        vm.etch(address(engine), address(alternate).code);
        bytes32 actual = address(engine).codehash;
        vm.expectRevert(
            abi.encodeWithSelector(
                CoreV1.EngineRuntimeCodeHashMismatch.selector, address(engine), descriptor.runtimeCodeHash, actual
            )
        );
        core.authenticateEngineRevision(revisionId);

        vm.expectRevert();
        core.createMarket(CoreTestFixtures.marketDescriptor(revisionId));
    }

    /// Threat: actor=proxy admin; authority=implementation slot; pre=entry hash pinned; attempt=upgrade; expect=execute
    /// blocked; post=no authority.
    function test_proxyShapedEntryIsOnlyPartialEntryHashEvidenceAndNeverAuthority() external {
        CoreV1 core = new CoreV1(CoreTestFixtures.CONSTITUTION_ID, CoreTestFixtures.COLLECTOR);
        EntryCodeOnlyEngineMock implementationA = new EntryCodeOnlyEngineMock();
        AlternateEntryCodeOnlyEngineMock implementationB = new AlternateEntryCodeOnlyEngineMock();
        ProxyShapedEntryEngineMock proxy = new ProxyShapedEntryEngineMock(address(implementationA));
        EngineRevisionDescriptorV1 memory descriptor = CoreTestFixtures.engineDescriptor(core, address(proxy));
        bytes32 revisionId = core.registerEngineRevision(descriptor);

        proxy.setImplementation(address(implementationB));
        assertEq(
            core.authenticateEngineRevision(revisionId), address(proxy), "entry hash unexpectedly tracks proxy storage"
        );

        vm.expectRevert(
            abi.encodeWithSelector(CoreV1.BlockedBySpec.selector, core.DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR())
        );
        core.executeProtected("");
    }

    /// Threat: actor=Engine caller; authority=action bytes; pre=empty state; attempt=max+1; expect=revert; post=max
    /// returns no proposal.
    function test_opaqueReferenceEngineEnforcesMaximumPlusOneAndReturnsNoProtectedProposal() external {
        OpaqueStateEngineV1 engine = new OpaqueStateEngineV1();
        bytes memory maximumPlusOne = new bytes(ReturnOnlyEngineLimitsV1.MAX_ACTION_PAYLOAD_BYTES + 1);
        OpaqueEngineRequestV1 memory oversizedRequest = _request(maximumPlusOne);
        vm.expectRevert();
        engine.proposeOpaque(oversizedRequest);

        bytes memory acceptedPayload = new bytes(ReturnOnlyEngineLimitsV1.MAX_ACTION_PAYLOAD_BYTES);
        OpaqueEngineRequestV1 memory acceptedRequest = _request(acceptedPayload);
        OpaqueEngineResponseV1 memory response = engine.proposeOpaque(acceptedRequest);
        assertEq(response.sessionDigest, acceptedRequest.sessionDigest);
        assertEq(response.segmentIndex, acceptedRequest.segmentIndex);
        assertEq(response.proposal.length, 0, "reference Engine exposed a protected proposal branch");
        assertLe(response.opaqueData.length, ReturnOnlyEngineLimitsV1.MAX_OPAQUE_DATA_BYTES);
    }

    function _prepareToken(IHostileTokenFixture token, bytes32 salt) private returns (DomainVaultV1 vault) {
        vault = controller.deployVault(
            salt, controller.coreDeploymentId(), DOMAIN_REVISION_ID, ERC20_PROFILE, address(token)
        );
        token.mint(source, 1000);
        vm.prank(source);
        token.approve(address(vault), 1000);
    }

    function _assertNoTokenMovement(IHostileTokenFixture token, DomainVaultV1 vault) private view {
        assertEq(token.balanceOf(source), 1000, "hostile source debit survived rollback");
        assertEq(token.balanceOf(address(vault)), 0, "hostile vault credit survived rollback");
    }

    function _deployNativeVault(bytes32 salt) private returns (DomainVaultV1) {
        return
            controller.deployVault(salt, controller.coreDeploymentId(), DOMAIN_REVISION_ID, NATIVE_PROFILE, address(0));
    }

    function _request(bytes memory payload) private pure returns (OpaqueEngineRequestV1 memory request) {
        request = OpaqueEngineRequestV1({
            coreDeploymentId: keccak256("core"),
            engineRevisionId: keccak256("engine"),
            marketId: keccak256("market"),
            authorizationScopeId: keccak256("scope"),
            sessionDigest: keccak256("session"),
            executionTargetId: keccak256("target"),
            actionPayloadDigest: keccak256(payload),
            segmentIndex: 0,
            phase: 2,
            actionPayload: payload
        });
    }
}
