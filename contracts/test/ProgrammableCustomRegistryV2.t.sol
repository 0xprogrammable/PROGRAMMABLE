// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Test } from "forge-std/Test.sol";

import { ProgrammableCustomRegistryV2 } from "../src/ProgrammableCustomRegistryV2.sol";
import { IProgrammableCustomRegistryV2 } from "../src/interfaces/IProgrammableCustomRegistryV2.sol";

contract NeutralRegistryRuntimeV2 {
    function registryFixtureVersion() external pure returns (uint256) {
        return 2;
    }
}

contract NeutralOperationalControllerV2 { }

contract ProgrammableCustomRegistryV2Test is Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal APPROVER;
    address internal REGISTRAR;
    address internal FINALIZER;
    address internal REVOKER;
    address internal constant OUTSIDER = address(0xBAD);
    address internal constant LAUNCH_WALLET = address(0x1A0C);

    ProgrammableCustomRegistryV2 internal registry;
    NeutralRegistryRuntimeV2 internal target;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        APPROVER = address(new NeutralOperationalControllerV2());
        REGISTRAR = address(new NeutralOperationalControllerV2());
        FINALIZER = address(new NeutralOperationalControllerV2());
        REVOKER = address(new NeutralOperationalControllerV2());
        target = new NeutralRegistryRuntimeV2();
        registry = new ProgrammableCustomRegistryV2(_config());
    }

    function test_constructorBindsNeutralGenerationAndLeastPrivilege() public view {
        assertEq(registry.CHAIN_ID(), 1);
        assertEq(registry.REGISTRY_GENERATION(), 2);
        assertEq(registry.MINIMUM_FINALITY_BLOCKS(), 3);
        assertEq(registry.STANDARD10_PROTOCOL_FEE_BPS(), 10);
        assertEq(registry.NO_MARKET0_PROTOCOL_FEE_BPS(), 0);
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertTrue(registry.hasRole(registry.APPROVER_ROLE(), APPROVER));
        assertTrue(registry.hasRole(registry.REGISTRAR_ROLE(), REGISTRAR));
        assertTrue(registry.hasRole(registry.FINALIZER_ROLE(), FINALIZER));
        assertTrue(registry.hasRole(registry.REVOKER_ROLE(), REVOKER));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), REGISTRAR));
    }

    function test_operationalRolesRemainImmutableAndSeparatedAfterDeployment() public {
        bytes32[4] memory roles =
            [registry.APPROVER_ROLE(), registry.REGISTRAR_ROLE(), registry.FINALIZER_ROLE(), registry.REVOKER_ROLE()];
        address[4] memory holders = [APPROVER, REGISTRAR, FINALIZER, REVOKER];
        for (uint256 i = 0; i < roles.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(ProgrammableCustomRegistryV2.ImmutableOperationalRole.selector, roles[i])
            );
            vm.prank(ADMIN);
            registry.grantRole(roles[i], ADMIN);

            vm.expectRevert(
                abi.encodeWithSelector(ProgrammableCustomRegistryV2.ImmutableOperationalRole.selector, roles[i])
            );
            vm.prank(ADMIN);
            registry.revokeRole(roles[i], holders[i]);

            vm.expectRevert(
                abi.encodeWithSelector(ProgrammableCustomRegistryV2.ImmutableOperationalRole.selector, roles[i])
            );
            vm.prank(holders[i]);
            registry.renounceRole(roles[i], holders[i]);
        }
    }

    function test_operationalControllerRotatesInTwoStepsWithoutRoleCollapse() public {
        address successor = address(new NeutralOperationalControllerV2());
        bytes32 approverRole = registry.APPROVER_ROLE();
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        vm.prank(ADMIN);
        registry.beginOperationalControllerTransfer(approverRole, successor);
        assertEq(registry.pendingOperationalController(approverRole).controller, successor);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRegistryV2.OperationalControllerTransferNotReady.selector,
                approverRole,
                successor,
                registry.pendingOperationalController(approverRole).acceptAfter
            )
        );
        vm.prank(successor);
        registry.acceptOperationalControllerTransfer(approverRole);

        vm.warp(block.timestamp + registry.defaultAdminDelay());
        vm.prank(successor);
        registry.acceptOperationalControllerTransfer(approverRole);
        assertEq(registry.operationalController(approverRole), successor);
        assertTrue(registry.hasRole(approverRole, successor));
        assertFalse(registry.hasRole(approverRole, APPROVER));

        vm.prank(ADMIN);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV2.OperationalControllerConflict.selector, successor)
        );
        registry.beginOperationalControllerTransfer(registrarRole, successor);

        vm.prank(ADMIN);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCustomRegistryV2.OperationalControllerConflict.selector, successor)
        );
        registry.beginDefaultAdminTransfer(successor);

        address canceled = address(new NeutralOperationalControllerV2());
        vm.prank(ADMIN);
        registry.beginOperationalControllerTransfer(approverRole, canceled);
        vm.prank(ADMIN);
        registry.cancelOperationalControllerTransfer(approverRole);
        assertEq(registry.pendingOperationalController(approverRole).controller, address(0));
    }

    function test_marketDescriptorRegistersOnlyAtStandard10() public {
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory descriptor = _descriptor(target, true);
        (bytes32 approvalId, bytes32 descriptorHash) = _authorize(descriptor, "market");

        vm.prank(REGISTRAR);
        (bytes32 launchId, bytes32 registeredHash) =
            registry.registerLaunch(descriptor, approvalId, _hash("market-registration"));

        assertEq(registeredHash, descriptorHash);
        assertEq(launchId, registry.computeLaunchId(descriptorHash));
        assertTrue(registry.descriptorRegistered(descriptorHash));
        assertTrue(registry.primaryContractRegistered(address(target)));
        assertEq(
            uint8(registry.launchState(launchId).status), uint8(IProgrammableCustomRegistryV2.LaunchStatus.Observed)
        );
        assertEq(registry.launchDescriptor(launchId).protocolFeeBps, 10);
        assertTrue(registry.approvalState(approvalId).consumed);
    }

    function test_noMarketDescriptorRegistersOnlyAtZero() public {
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory descriptor = _descriptor(target, false);
        (bytes32 approvalId,) = _authorize(descriptor, "no-market");

        vm.prank(REGISTRAR);
        (bytes32 launchId,) = registry.registerLaunch(descriptor, approvalId, _hash("no-market-registration"));

        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory stored = registry.launchDescriptor(launchId);
        assertEq(uint8(stored.marketMode), uint8(IProgrammableCustomRegistryV2.MarketMode.NoMarket));
        assertEq(stored.protocolFeeBps, 0);
    }

    function test_rejectsEveryNoncanonicalFeePair() public {
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory market = _descriptor(target, true);
        market.protocolFeeBps = 9;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRegistryV2.InvalidPolicy.selector,
                IProgrammableCustomRegistryV2.MarketMode.Market,
                uint16(9)
            )
        );
        registry.computeDescriptorHash(market);

        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory noMarket = _descriptor(target, false);
        noMarket.protocolFeeBps = 10;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRegistryV2.InvalidPolicy.selector,
                IProgrammableCustomRegistryV2.MarketMode.NoMarket,
                uint16(10)
            )
        );
        registry.computeDescriptorHash(noMarket);
    }

    function test_registrationRequiresExactApprovalRuntimeAndRole() public {
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory descriptor = _descriptor(target, true);
        (bytes32 approvalId,) = _authorize(descriptor, "binding");

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, OUTSIDER, registry.REGISTRAR_ROLE()
            )
        );
        vm.prank(OUTSIDER);
        registry.registerLaunch(descriptor, approvalId, _hash("binding-registration"));

        descriptor.configurationHash = _hash("mutated-config");
        vm.expectPartialRevert(ProgrammableCustomRegistryV2.DescriptorHashMismatch.selector);
        vm.prank(REGISTRAR);
        registry.registerLaunch(descriptor, approvalId, _hash("binding-registration"));

        descriptor = _descriptor(target, true);
        descriptor.primaryRuntimeCodeHash = _hash("wrong-runtime");
        (approvalId,) = _authorize(descriptor, "wrong-runtime");
        vm.expectPartialRevert(ProgrammableCustomRegistryV2.RuntimeCodeHashMismatch.selector);
        vm.prank(REGISTRAR);
        registry.registerLaunch(descriptor, approvalId, _hash("wrong-runtime-registration"));
    }

    function test_finalizationRequiresCanonicalNativeBlockhashDepth() public {
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory descriptor = _descriptor(target, true);
        (bytes32 approvalId,) = _authorize(descriptor, "finality");
        vm.prank(REGISTRAR);
        (bytes32 launchId,) = registry.registerLaunch(descriptor, approvalId, _hash("finality-registration"));

        bytes32 observedHash = _hash("block-100");
        bytes32 headHash = _hash("block-103");
        vm.roll(104);
        vm.setBlockhash(100, observedHash);
        vm.setBlockhash(103, headHash);

        IProgrammableCustomRegistryV2.FinalityEvidenceV2 memory evidence =
            IProgrammableCustomRegistryV2.FinalityEvidenceV2({
                observedBlockHash: observedHash,
                confirmedHeadBlock: 102,
                confirmedHeadBlockHash: _hash("block-102"),
                finalityEvidenceHash: _hash("premature-finality")
            });
        vm.setBlockhash(102, evidence.confirmedHeadBlockHash);
        vm.expectPartialRevert(ProgrammableCustomRegistryV2.FinalityDepthInsufficient.selector);
        vm.prank(FINALIZER);
        registry.finalizeLaunch(launchId, evidence);

        evidence.confirmedHeadBlock = 103;
        evidence.confirmedHeadBlockHash = headHash;
        evidence.finalityEvidenceHash = _hash("valid-finality");
        vm.prank(FINALIZER);
        registry.finalizeLaunch(launchId, evidence);

        IProgrammableCustomRegistryV2.LaunchStateV2 memory state = registry.launchState(launchId);
        assertEq(uint8(state.status), uint8(IProgrammableCustomRegistryV2.LaunchStatus.Finalized));
        assertEq(state.finalizedAtBlock, 104);
        assertEq(state.finalityEvidenceHash, evidence.finalityEvidenceHash);
    }

    function test_evidenceIsGloballySingleUseAndDescriptorCannotRepeat() public {
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory descriptor = _descriptor(target, true);
        (bytes32 approvalId,) = _authorize(descriptor, "single-use");
        bytes32 registrationEvidenceHash = _hash("single-registration");
        vm.prank(REGISTRAR);
        registry.registerLaunch(descriptor, approvalId, registrationEvidenceHash);

        IProgrammableCustomRegistryV2.ApprovalAuthorizationV2 memory replay =
            IProgrammableCustomRegistryV2.ApprovalAuthorizationV2({
                approvalId: _hash("replay-approval"),
                descriptorHash: _hash("replay-descriptor"),
                validAfterBlock: 100,
                expiresAtBlock: 200,
                approvalEvidenceHash: registrationEvidenceHash
            });
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCustomRegistryV2.EvidenceAlreadyConsumed.selector, registrationEvidenceHash
            )
        );
        vm.prank(APPROVER);
        registry.authorizeApproval(replay);
    }

    function test_revocationIsAppendOnlyAndTerminal() public {
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory descriptor = _descriptor(target, false);
        (bytes32 approvalId,) = _authorize(descriptor, "revoke");
        vm.prank(REGISTRAR);
        (bytes32 launchId,) = registry.registerLaunch(descriptor, approvalId, _hash("revoke-registration"));

        vm.prank(REVOKER);
        registry.revokeLaunch(launchId, _hash("revoke-evidence"), _hash("reason"));
        assertEq(
            uint8(registry.launchState(launchId).status), uint8(IProgrammableCustomRegistryV2.LaunchStatus.Revoked)
        );

        vm.expectPartialRevert(ProgrammableCustomRegistryV2.InvalidLaunchState.selector);
        vm.prank(REVOKER);
        registry.revokeLaunch(launchId, _hash("second-revoke"), _hash("reason-2"));
    }

    function _authorize(IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory descriptor, string memory label)
        private
        returns (bytes32 approvalId, bytes32 descriptorHash)
    {
        descriptorHash = registry.computeDescriptorHash(descriptor);
        approvalId = keccak256(abi.encode("approval", label));
        IProgrammableCustomRegistryV2.ApprovalAuthorizationV2 memory authorization =
            IProgrammableCustomRegistryV2.ApprovalAuthorizationV2({
                approvalId: approvalId,
                descriptorHash: descriptorHash,
                validAfterBlock: uint64(block.number),
                expiresAtBlock: uint64(block.number + 100),
                approvalEvidenceHash: keccak256(abi.encode("approval-evidence", label))
            });
        vm.prank(APPROVER);
        registry.authorizeApproval(authorization);
    }

    function _descriptor(NeutralRegistryRuntimeV2 runtimeTarget, bool market)
        private
        view
        returns (IProgrammableCustomRegistryV2.LaunchDescriptorV2 memory)
    {
        return IProgrammableCustomRegistryV2.LaunchDescriptorV2({
            chainId: 1,
            launchWallet: LAUNCH_WALLET,
            primaryContract: address(runtimeTarget),
            primaryRuntimeCodeHash: address(runtimeTarget).codehash,
            componentSetHash: _hash("component-set"),
            sourceArtifactHash: _hash("source-artifact"),
            configurationHash: _hash("configuration"),
            launchPlanHash: _hash("launch-plan"),
            projectCommitment: _hash("project"),
            marketMode: market
                ? IProgrammableCustomRegistryV2.MarketMode.Market
                : IProgrammableCustomRegistryV2.MarketMode.NoMarket,
            protocolFeeBps: market ? 10 : 0
        });
    }

    function _config() private view returns (ProgrammableCustomRegistryV2.RegistryConfigV2 memory) {
        return ProgrammableCustomRegistryV2.RegistryConfigV2({
            initialAdminDelay: 2 days,
            initialAdmin: ADMIN,
            initialApprover: APPROVER,
            initialRegistrar: REGISTRAR,
            initialFinalizer: FINALIZER,
            initialRevoker: REVOKER,
            minimumFinalityBlocks: 3,
            registryPolicyCommitment: _hash("neutral-generation-two-policy")
        });
    }

    function _hash(string memory value) private pure returns (bytes32) {
        return keccak256(bytes(value));
    }
}
