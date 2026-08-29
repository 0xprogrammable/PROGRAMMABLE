// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DomainVaultV1 } from "../../src/core/DomainVaultV1.sol";
import { NativeIdentityV1 } from "../../src/core/NativeIdentityV1.sol";
import { TransferObservationV1 } from "../../src/interfaces/IDomainVaultV1.sol";
import { VaultControllerHarness } from "../mocks/VaultControllerHarness.sol";
import { GasRecordingERC20Mock, StrictERC20Mock } from "../mocks/MockERC20s.sol";
import { GasRecordingNativeRecipientMock } from "../mocks/NativeRecipients.sol";

contract DomainVaultV1Test is Test {
    bytes32 internal constant DOMAIN_REVISION_ID = keccak256("domain revision");
    bytes32 internal constant NATIVE_PROFILE = keccak256("programmable.dex.evm.asset-profile.native-eth-strict.v1");
    bytes32 internal constant ERC20_PROFILE = keccak256("programmable.dex.evm.asset-profile.erc20-strict-measured.v1");
    bytes32 internal constant CLONE_TEST_CONSTITUTION_ID = keccak256("clone test constitution");
    uint32 internal constant CLONE_TEST_CORE_MAJOR = 1;
    address internal constant CLONE_TEST_COLLECTOR = address(0xC011EC70);

    VaultControllerHarness internal controller;
    address internal source;
    address internal recipient;

    function setUp() external {
        controller = new VaultControllerHarness();
        source = makeAddr("authorized token source");
        recipient = makeAddr("exact recipient");
    }

    function test_nativeVaultAcceptsDonationAndTransfersExactDebitAndCredit() external {
        DomainVaultV1 vault = _deployNativeVault(keccak256("native vault"));
        vm.deal(address(this), 10 ether);
        (bool funded,) = address(vault).call{ value: 5 ether }("");
        assertTrue(funded);

        uint256 recipientBefore = recipient.balance;
        TransferObservationV1 memory observation = controller.pushNative(vault, payable(recipient), 2 ether);
        assertEq(observation.grossSourceDebit, 2 ether);
        assertEq(observation.spendableDestinationCredit, 2 ether);
        assertEq(address(vault).balance, 3 ether);
        assertEq(recipient.balance - recipientBefore, 2 ether);
    }

    function test_strictERC20PullAndPushMeasureBothEndpoints() external {
        StrictERC20Mock token = new StrictERC20Mock();
        DomainVaultV1 vault = _deployERC20Vault(keccak256("erc20 vault"), address(token));

        token.mint(source, 1000);
        vm.prank(source);
        token.approve(address(vault), 1000);

        TransferObservationV1 memory pull = controller.pullERC20(vault, source, 600);
        assertEq(pull.grossSourceDebit, 600);
        assertEq(pull.spendableDestinationCredit, 600);
        assertEq(token.balanceOf(source), 400);
        assertEq(token.balanceOf(address(vault)), 600);

        TransferObservationV1 memory push = controller.pushERC20(vault, recipient, 250);
        assertEq(push.grossSourceDebit, 250);
        assertEq(push.spendableDestinationCredit, 250);
        assertEq(token.balanceOf(address(vault)), 350);
        assertEq(token.balanceOf(recipient), 250);
    }

    function test_hostileExternalCallGasCapsAreObservedAtEntry() external {
        DomainVaultV1 nativeVault = _deployNativeVault(keccak256("native gas cap"));
        GasRecordingNativeRecipientMock nativeRecipient = new GasRecordingNativeRecipientMock();
        vm.deal(address(nativeVault), 1 ether);
        controller.pushNative(nativeVault, payable(address(nativeRecipient)), 1 ether);
        assertLe(nativeRecipient.gasAtEntry(), 50_000, "native recipient exceeded its execution cap");

        GasRecordingERC20Mock token = new GasRecordingERC20Mock();
        DomainVaultV1 tokenVault = _deployERC20Vault(keccak256("token gas cap"), address(token));
        token.mint(address(tokenVault), 100);
        controller.pushERC20(tokenVault, recipient, 100);
        assertLe(token.gasAtTransferEntry(), 120_000, "ERC-20 transfer exceeded its execution cap");
    }

    /// Threat: actor=external caller; authority=own calldata; pre=Core fixed; attempt=pull/push; expect=OnlyCore;
    /// post=unchanged.
    function test_onlyImmutableCoreCanMoveAssets() external {
        StrictERC20Mock token = new StrictERC20Mock();
        DomainVaultV1 vault = _deployERC20Vault(keccak256("only core vault"), address(token));

        vm.expectRevert(abi.encodeWithSelector(DomainVaultV1.OnlyCore.selector, address(this)));
        vault.pushERC20Exact(recipient, 1);
        vm.expectRevert(abi.encodeWithSelector(DomainVaultV1.OnlyCore.selector, address(this)));
        vault.pullERC20Exact(source, 1);
    }

    function test_assetProfileAndNativeAssetMustMatchExactly() external {
        bytes32 coreId = controller.coreDeploymentId();
        vm.expectRevert();
        controller.deployVault(keccak256("bad native"), coreId, DOMAIN_REVISION_ID, NATIVE_PROFILE, address(0xBEEF));

        vm.expectRevert();
        controller.deployVault(keccak256("bad token"), coreId, DOMAIN_REVISION_ID, ERC20_PROFILE, address(0));

        vm.expectRevert();
        controller.deployVault(
            keccak256("unknown profile"), coreId, DOMAIN_REVISION_ID, keccak256("unknown profile"), address(0)
        );
    }

    /// Threat: actor=counterfeit deployer; authority=constructor arguments; pre=canonical Core identity known;
    /// attempt=deploy exact DomainVaultV1 with the canonical identity preimage; expect=identity mismatch;
    /// protected post-state=no counterfeit exact-code vault can expose the canonical Core/Vault identity tuple.
    function test_counterfeitDeployerCannotCloneCanonicalCoreDeploymentIdentity() external {
        bytes32 canonicalCoreDeploymentId = NativeIdentityV1.coreDeploymentId(
            block.chainid, address(controller), CLONE_TEST_CONSTITUTION_ID, CLONE_TEST_CORE_MAJOR, CLONE_TEST_COLLECTOR
        );
        bytes32 counterfeitDerivedId = NativeIdentityV1.coreDeploymentId(
            block.chainid, address(this), CLONE_TEST_CONSTITUTION_ID, CLONE_TEST_CORE_MAJOR, CLONE_TEST_COLLECTOR
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                DomainVaultV1.CoreDeploymentIdMismatch.selector, canonicalCoreDeploymentId, counterfeitDerivedId
            )
        );
        new DomainVaultV1(
            canonicalCoreDeploymentId,
            CLONE_TEST_CONSTITUTION_ID,
            CLONE_TEST_CORE_MAJOR,
            CLONE_TEST_COLLECTOR,
            DOMAIN_REVISION_ID,
            NATIVE_PROFILE,
            address(0)
        );
    }

    function test_erc20VaultRejectsAccidentalNativeValue() external {
        StrictERC20Mock token = new StrictERC20Mock();
        DomainVaultV1 vault = _deployERC20Vault(keccak256("no native value"), address(token));
        vm.deal(address(this), 1 ether);
        (bool success, bytes memory returnData) = address(vault).call{ value: 1 ether }("");
        assertFalse(success);
        assertEq(returnData, abi.encodeWithSelector(DomainVaultV1.NativeValueRejected.selector));
        assertEq(address(vault).balance, 0);
    }

    /// Threat: actor=compromised request path; authority=recipient field; pre=vault isolated; attempt=pay Core;
    /// expect=revert; post=vault.
    function test_coreCannotBeTransferRecipient() external {
        StrictERC20Mock token = new StrictERC20Mock();
        DomainVaultV1 vault = _deployERC20Vault(keccak256("core recipient"), address(token));
        vm.expectRevert(abi.encodeWithSelector(DomainVaultV1.CoreRecipientForbidden.selector, address(controller)));
        controller.pushERC20(vault, address(controller), 1);

        DomainVaultV1 nativeVault = _deployNativeVault(keccak256("native core recipient"));
        vm.expectRevert(abi.encodeWithSelector(DomainVaultV1.CoreRecipientForbidden.selector, address(controller)));
        controller.pushNative(nativeVault, payable(address(controller)), 1);
    }

    function _deployNativeVault(bytes32 salt) private returns (DomainVaultV1) {
        return
            controller.deployVault(salt, controller.coreDeploymentId(), DOMAIN_REVISION_ID, NATIVE_PROFILE, address(0));
    }

    function _deployERC20Vault(bytes32 salt, address token) private returns (DomainVaultV1) {
        return controller.deployVault(salt, controller.coreDeploymentId(), DOMAIN_REVISION_ID, ERC20_PROFILE, token);
    }
}
