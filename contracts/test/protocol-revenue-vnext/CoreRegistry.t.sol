// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

import {
    IProgrammableProtocolFeeSourceV1,
    ProtocolRevenueSourceConfigV1
} from "../../src/protocol-revenue-vnext/IProgrammableProtocolFeeSourceV1.sol";
import { ProtocolRevenueSourceRegistryV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueSourceRegistryV1.sol";
import {
    CoreBombFeeSource,
    CoreMockERC20,
    CoreStandardFeeSource,
    CoreStandardFeeSourceV2,
    CoreTestBase
} from "./CoreTestBase.t.sol";

contract CoreRegistryTest is CoreTestBase {
    function test_exactFrozenConstantsAndIdentityDomains() public view {
        assertEq(IProgrammableProtocolFeeSourceV1.programmableFeeRecipient.selector, bytes4(0x424ff2a5));
        assertEq(IProgrammableProtocolFeeSourceV1.accruedProgrammableFees.selector, bytes4(0x3129853d));
        assertEq(IProgrammableProtocolFeeSourceV1.totalProgrammableFeesClaimed.selector, bytes4(0x4a383b32));
        assertEq(IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector, bytes4(0xb9d2fad0));
        assertEq(type(IProgrammableProtocolFeeSourceV1).interfaceId, bytes4(0x808cb67a));
        assertEq(
            registry.SOURCE_ID_DOMAIN(), bytes32(0xdc2912e387e82a76ec4aeb445b011608abb40754ced5b72004f20b8c8a294db8)
        );
        assertEq(
            registry.PROPOSAL_HASH_DOMAIN(), bytes32(0x72f54f8e155e35dcf22367ee8f07ed9d1a3b3c3b0616acb67e167b2695c5af73)
        );
        assertEq(registry.SOURCE_INTERFACE_ID(), bytes4(0x808cb67a));
        assertEq(registry.CLAIM_SELECTOR(), bytes4(0xb9d2fad0));
        assertEq(registry.REGISTRY_GENERATION(), 1);
        assertEq(registry.CHAIN_ID(), block.chainid);
        assertEq(registry.REWARD_WALLET(), REWARD_WALLET);
        assertEq(collector.REWARD_WALLET(), REWARD_WALLET);
        assertEq(executor.REWARD_WALLET(), REWARD_WALLET);
    }

    function test_sourceAndProposalHashesUseExactFrozenFormulas() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        ProtocolRevenueSourceConfigV1 memory config =
            _config(address(source), address(0), uint64(block.number + ACTIVATION_DELAY));
        bytes32 expectedSourceId = keccak256(
            abi.encode(
                bytes32(0xdc2912e387e82a76ec4aeb445b011608abb40754ced5b72004f20b8c8a294db8),
                block.chainid,
                address(registry),
                address(source),
                address(source).codehash,
                address(0),
                bytes4(0xb9d2fad0),
                REWARD_WALLET
            )
        );
        bytes32 expectedProposalHash = keccak256(
            abi.encode(
                bytes32(0x72f54f8e155e35dcf22367ee8f07ed9d1a3b3c3b0616acb67e167b2695c5af73),
                expectedSourceId,
                config.activationBlock,
                ACTIVATION_DELAY
            )
        );

        assertEq(config.sourceId, expectedSourceId);
        assertEq(registry.computeProposalHash(config), expectedProposalHash);
        assertEq(
            registry.computeSourceAssetKey(address(source), address(0)),
            keccak256(abi.encode(block.chainid, address(source), address(0)))
        );
    }

    function test_registrationRequiresProposalDelayAndIndependentActivator() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        ProtocolRevenueSourceConfigV1 memory config =
            _config(address(source), address(0), uint64(block.number + ACTIVATION_DELAY));

        vm.prank(proposer);
        bytes32 proposalHash = registry.proposeSource(config);
        assertNotEq(proposalHash, bytes32(0));
        (ProtocolRevenueSourceConfigV1 memory beforeActivation, bool registered,) =
            registry.sourceState(config.sourceId);
        assertFalse(registered);
        assertEq(beforeActivation.source, address(0));

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueSourceRegistryV1.ActivationNotReached.selector, config.activationBlock, block.number
            )
        );
        vm.prank(activator);
        registry.activateSource(config.sourceId);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, proposer, registry.SOURCE_ACTIVATOR_ROLE()
            )
        );
        vm.prank(proposer);
        registry.activateSource(config.sourceId);

        vm.roll(config.activationBlock);
        vm.prank(activator);
        registry.activateSource(config.sourceId);

        (ProtocolRevenueSourceConfigV1 memory active, bool isRegistered, bool quarantined) =
            registry.sourceState(config.sourceId);
        assertTrue(isRegistered);
        assertFalse(quarantined);
        assertEq(active.sourceId, config.sourceId);
        assertEq(active.source, address(source));
        assertEq(active.runtimeCodeHash, address(source).codehash);
        assertEq(active.asset, address(0));
        assertEq(active.claimSelector, IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector);
        assertEq(active.recipient, REWARD_WALLET);
        assertTrue(registry.isExecutable(config.sourceId));
        assertEq(registry.sourceCount(), 1);
        assertEq(registry.sourceIdAt(0), config.sourceId);
    }

    function test_predictedSourceCanBeProposedBeforeCreate2Deployment() public {
        CoreStandardFeeSource implementation = new CoreStandardFeeSource();
        address predicted = makeAddr("predictedSource");
        ProtocolRevenueSourceConfigV1 memory config = ProtocolRevenueSourceConfigV1({
            sourceId: bytes32(0),
            source: predicted,
            runtimeCodeHash: address(implementation).codehash,
            asset: address(0),
            claimSelector: IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector,
            recipient: REWARD_WALLET,
            activationBlock: uint64(block.number + ACTIVATION_DELAY)
        });
        config.sourceId = registry.computeSourceId(config);

        vm.prank(proposer);
        registry.proposeSource(config);
        vm.roll(config.activationBlock);
        vm.etch(predicted, address(implementation).code);
        vm.prank(activator);
        registry.activateSource(config.sourceId);

        assertTrue(registry.isExecutable(config.sourceId));
    }

    function test_activationRejectsRuntimeCodeDrift() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        ProtocolRevenueSourceConfigV1 memory config =
            _config(address(source), address(0), uint64(block.number + ACTIVATION_DELAY));
        vm.prank(proposer);
        registry.proposeSource(config);
        vm.roll(config.activationBlock);
        vm.etch(address(source), hex"60006000fd");

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueSourceRegistryV1.SourceRuntimeCodeHashMismatch.selector,
                address(source),
                config.runtimeCodeHash,
                address(source).codehash
            )
        );
        vm.prank(activator);
        registry.activateSource(config.sourceId);
    }

    function test_activationRejectsOverlongButPrefixValidViewReturn() public {
        CoreBombFeeSource source = new CoreBombFeeSource();
        ProtocolRevenueSourceConfigV1 memory config =
            _config(address(source), address(0), uint64(block.number + ACTIVATION_DELAY));
        vm.prank(proposer);
        registry.proposeSource(config);
        source.setMode(CoreBombFeeSource.Mode.OverlongViews);
        vm.roll(config.activationBlock);

        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueSourceRegistryV1.SourceInterfaceMismatch.selector, address(source))
        );
        vm.prank(activator);
        registry.activateSource(config.sourceId);

        (, bool registered, bool quarantined) = registry.sourceState(config.sourceId);
        assertFalse(registered);
        assertFalse(quarantined);
        assertFalse(registry.isExecutable(config.sourceId));

        source.setMode(CoreBombFeeSource.Mode.Valid);
        vm.prank(activator);
        registry.activateSource(config.sourceId);
        assertTrue(registry.isExecutable(config.sourceId));
        source.setMode(CoreBombFeeSource.Mode.OverlongViews);
        assertFalse(registry.isExecutable(config.sourceId));
    }

    function test_activationRechecksErc20AssetCode() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        CoreMockERC20 token = new CoreMockERC20();
        ProtocolRevenueSourceConfigV1 memory config =
            _config(address(source), address(token), uint64(block.number + ACTIVATION_DELAY));
        vm.prank(proposer);
        registry.proposeSource(config);
        vm.etch(address(token), bytes(""));
        vm.roll(config.activationBlock);

        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueSourceRegistryV1.SourceAssetCodeMissing.selector, address(token))
        );
        vm.prank(activator);
        registry.activateSource(config.sourceId);
    }

    function test_activationRejectsSourceWithHistoricalClaims() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        source.accrueNative{ value: 0.2 ether }();
        source.claimProgrammableFees(address(0));
        ProtocolRevenueSourceConfigV1 memory config =
            _config(address(source), address(0), uint64(block.number + ACTIVATION_DELAY));
        vm.prank(proposer);
        registry.proposeSource(config);
        vm.roll(config.activationBlock);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueSourceRegistryV1.SourcePreviouslyClaimed.selector, address(source), address(0), 0.2 ether
            )
        );
        vm.prank(activator);
        registry.activateSource(config.sourceId);
    }

    function test_quarantineIsFailClosedAndBindingRemainsImmutable() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 sourceId = _register(address(source), address(0));
        vm.prank(quarantiner);
        registry.quarantineSource(sourceId, keccak256("source-review"));

        (ProtocolRevenueSourceConfigV1 memory config, bool registered, bool quarantined) =
            registry.sourceState(sourceId);
        assertTrue(registered);
        assertTrue(quarantined);
        assertEq(config.source, address(source));
        assertFalse(registry.isExecutable(sourceId));

        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueSourceRegistryV1.SourceAlreadyRegistered.selector, sourceId)
        );
        vm.prank(proposer);
        registry.proposeSource(config);
    }

    function test_sourceAssetKeyCannotHaveTwoActiveRuntimeBindings() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        bytes32 originalSourceId = _register(address(source), address(0));
        assertEq(registry.sourceIdFor(address(source), address(0)), originalSourceId);

        CoreStandardFeeSourceV2 replacementImplementation = new CoreStandardFeeSourceV2();
        vm.etch(address(source), address(replacementImplementation).code);
        ProtocolRevenueSourceConfigV1 memory replacement =
            _config(address(source), address(0), uint64(block.number + ACTIVATION_DELAY));
        assertNotEq(replacement.sourceId, originalSourceId);
        vm.prank(proposer);
        registry.proposeSource(replacement);
        vm.roll(replacement.activationBlock);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueSourceRegistryV1.SourceAssetAlreadyActive.selector,
                address(source),
                address(0),
                originalSourceId
            )
        );
        vm.prank(activator);
        registry.activateSource(replacement.sourceId);

        vm.prank(quarantiner);
        registry.quarantineSource(originalSourceId, keccak256("reviewed-runtime-transition"));
        vm.prank(activator);
        registry.activateSource(replacement.sourceId);

        assertEq(registry.sourceIdFor(address(source), address(0)), replacement.sourceId);
        assertFalse(registry.isExecutable(originalSourceId));
        assertTrue(registry.isExecutable(replacement.sourceId));
        assertEq(registry.sourceCount(), 2);
    }

    function test_defaultAdminCannotTransferToOperationalRoleHolder() public {
        vm.prank(admin);
        registry.beginDefaultAdminTransfer(proposer);
        (, uint48 schedule) = registry.pendingDefaultAdmin();
        vm.warp(uint256(schedule) + 1);

        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueSourceRegistryV1.IncompatibleOperationalRoles.selector, proposer)
        );
        vm.prank(proposer);
        registry.acceptDefaultAdminTransfer();

        assertEq(registry.defaultAdmin(), admin);
        assertTrue(registry.hasRole(registry.SOURCE_PROPOSER_ROLE(), proposer));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), proposer));
    }

    function test_rejectsWrongSelectorAndRecipient() public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        ProtocolRevenueSourceConfigV1 memory config =
            _config(address(source), address(0), uint64(block.number + ACTIVATION_DELAY));
        config.claimSelector = bytes4(keccak256("arbitraryCall(bytes)"));
        config.sourceId = registry.computeSourceId(config);
        bytes32 claimSelectorField = "claim-selector";
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueSourceRegistryV1.InvalidSourceBinding.selector, claimSelectorField)
        );
        vm.prank(proposer);
        registry.proposeSource(config);

        config.claimSelector = IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector;
        config.recipient = makeAddr("wrongRecipient");
        config.sourceId = registry.computeSourceId(config);
        bytes32 recipientField = "recipient";
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueSourceRegistryV1.InvalidSourceBinding.selector, recipientField)
        );
        vm.prank(proposer);
        registry.proposeSource(config);
    }

    function testFuzz_activationBlockMustRespectDelay(uint32 shortfall) public {
        CoreStandardFeeSource source = new CoreStandardFeeSource();
        uint256 missing = bound(uint256(shortfall), 1, ACTIVATION_DELAY);
        // Test block numbers and the five-block delay are both far below uint64.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 supplied = uint64(block.number + ACTIVATION_DELAY - missing);
        ProtocolRevenueSourceConfigV1 memory config = _config(address(source), address(0), supplied);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueSourceRegistryV1.ActivationBlockTooEarly.selector,
                supplied,
                block.number + ACTIVATION_DELAY
            )
        );
        vm.prank(proposer);
        registry.proposeSource(config);
    }
}
