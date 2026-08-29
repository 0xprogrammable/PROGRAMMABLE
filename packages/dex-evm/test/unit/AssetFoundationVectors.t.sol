// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DomainVaultV1 } from "../../src/core/DomainVaultV1.sol";
import { TransferObservationV1 } from "../../src/interfaces/IDomainVaultV1.sol";
import { NativeETHProfileV1 } from "../../src/profiles/NativeETHProfileV1.sol";
import { StrictMeasuredERC20ProfileV1 } from "../../src/profiles/StrictMeasuredERC20ProfileV1.sol";
import {
    ExactPlusOneReturnERC20Mock,
    FalseReturnERC20Mock,
    FeeOnTransferERC20Mock,
    NoReturnERC20Mock,
    OverDebitERC20Mock,
    StrictERC20Mock
} from "../mocks/MockERC20s.sol";
import {
    ConfigurableReturnNativeRecipientMock,
    ForwardingNativeRecipientMock,
    NativeSinkMock,
    RevertingNativeRecipientMock
} from "../mocks/NativeRecipients.sol";
import { VaultControllerHarness } from "../mocks/VaultControllerHarness.sol";

interface IAssetVectorToken {
    function mint(address account, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract AssetFoundationVectorsTest is Test {
    string internal constant VECTOR_PATH = "binding/vectors/asset-foundations-v1.json";

    bytes32 internal constant DOMAIN_REVISION_ID = keccak256("asset vector domain revision");
    bytes32 internal constant NATIVE_PROFILE = keccak256("programmable.dex.evm.asset-profile.native-eth-strict.v1");
    bytes32 internal constant ERC20_PROFILE = keccak256("programmable.dex.evm.asset-profile.erc20-strict-measured.v1");

    bytes4 internal constant TRANSFER_SELECTOR = 0xa9059cbb;
    bytes4 internal constant TRANSFER_FROM_SELECTOR = 0x23b872dd;

    struct AssetCase {
        bool accepted;
        uint128 amount;
        string caseId;
        uint256 committedDestinationCredit;
        uint256 committedSourceDebit;
        string expectedError;
        string operation;
        uint256 returnBytes;
        string subjectBehavior;
    }

    VaultControllerHarness internal controller;
    address internal source;
    address internal recipient;

    function setUp() external {
        controller = new VaultControllerHarness();
        source = makeAddr("asset vector source");
        recipient = makeAddr("asset vector recipient");
    }

    function test_vectorMetadataExplicitlyExcludesEveryStrongerClaim() external view {
        string memory json = vm.readFile(VECTOR_PATH);
        assertEq(vm.parseJsonString(json, ".classification"), "BINDING_LOCAL_ASSET_FOUNDATIONS_ONLY_NON_CONFORMANCE");
        assertFalse(vm.parseJsonBool(json, ".claims.asset_profile_conformance"));
        assertFalse(vm.parseJsonBool(json, ".claims.evm_013"));
        assertFalse(vm.parseJsonBool(json, ".claims.lifetime_token_safety"));
        assertFalse(vm.parseJsonBool(json, ".claims.portable_conformance"));
        assertFalse(vm.parseJsonBool(json, ".claims.protected_execution"));
        assertEq(vm.parseJsonBytes32(json, ".profiles.native_eth.identifier"), NATIVE_PROFILE);
        assertEq(vm.parseJsonBytes32(json, ".profiles.strict_measured_erc20.identifier"), ERC20_PROFILE);
    }

    /// Threat: actor=hostile native recipient; authority=fallback/returndata/forwarding; pre=vault funded;
    /// attempt=all accepted and rejected vector pushes; expect=exact observation or atomic revert; post=vector deltas.
    function test_nativeETHFoundationVectorsExecuteAcceptedAndRejectedCases() external {
        string memory json = vm.readFile(VECTOR_PATH);
        uint256 maximumReturnBytes = vm.parseJsonUint(json, ".resource_boundaries.native_returndata_max_bytes");
        uint256 maximumPlusOne = vm.parseJsonUint(json, ".resource_boundaries.native_returndata_max_plus_one_bytes");
        assertEq(maximumReturnBytes, 256);
        assertEq(maximumPlusOne, maximumReturnBytes + 1);

        uint256 caseCount = vm.parseJsonUint(json, ".native_eth_case_count");
        for (uint256 i = 0; i < caseCount; ++i) {
            AssetCase memory vector = _readNativeCase(json, i);
            _executeNativeCase(vector, maximumReturnBytes);
        }
    }

    /// Threat: actor=hostile ERC-20; authority=transfer accounting/return ABI; pre=source or vault funded;
    /// attempt=all accepted and rejected vector transfers; expect=exact observation or atomic revert; post=vector
    /// deltas.
    function test_strictMeasuredERC20FoundationVectorsExecuteAcceptedAndRejectedCases() external {
        string memory json = vm.readFile(VECTOR_PATH);
        uint256 exactReturnBytes = vm.parseJsonUint(json, ".resource_boundaries.erc20_transfer_returndata_exact_bytes");
        uint256 exactPlusOne =
            vm.parseJsonUint(json, ".resource_boundaries.erc20_transfer_returndata_exact_plus_one_bytes");
        assertEq(exactReturnBytes, 32);
        assertEq(exactPlusOne, exactReturnBytes + 1);

        uint256 caseCount = vm.parseJsonUint(json, ".strict_measured_erc20_case_count");
        for (uint256 i = 0; i < caseCount; ++i) {
            AssetCase memory vector = _readERC20Case(json, i);
            _executeERC20Case(vector, exactReturnBytes);
        }
    }

    function _executeNativeCase(AssetCase memory vector, uint256 maximumReturnBytes) private {
        DomainVaultV1 vault = _deployNativeVault(keccak256(bytes(vector.caseId)));
        vm.deal(address(vault), 10 ether);

        address payable target;
        address sink;
        bytes32 behavior = keccak256(bytes(vector.subjectBehavior));
        if (behavior == keccak256("retain-empty-return")) {
            target = payable(recipient);
        } else if (behavior == keccak256("retain-configured-return")) {
            target = payable(address(new ConfigurableReturnNativeRecipientMock(vector.returnBytes)));
        } else if (behavior == keccak256("revert")) {
            target = payable(address(new RevertingNativeRecipientMock()));
        } else if (behavior == keccak256("forward")) {
            sink = address(new NativeSinkMock());
            target = payable(address(new ForwardingNativeRecipientMock(payable(sink))));
        } else {
            revert(string.concat("unknown native behavior: ", vector.subjectBehavior));
        }

        uint256 sourceBefore = address(vault).balance;
        uint256 destinationBefore = target.balance;
        if (vector.accepted) {
            assertEq(bytes(vector.expectedError).length, 0);
            TransferObservationV1 memory observation = controller.pushNative(vault, target, vector.amount);
            assertEq(observation.grossSourceDebit, vector.committedSourceDebit);
            assertEq(observation.spendableDestinationCredit, vector.committedDestinationCredit);
        } else {
            _expectNativeRevert(vector, target, maximumReturnBytes);
            controller.pushNative(vault, target, vector.amount);
        }

        assertEq(sourceBefore - address(vault).balance, vector.committedSourceDebit);
        assertEq(target.balance - destinationBefore, vector.committedDestinationCredit);
        if (sink != address(0)) assertEq(sink.balance, 0, "forwarded native credit survived rollback");
    }

    function _executeERC20Case(AssetCase memory vector, uint256 exactReturnBytes) private {
        IAssetVectorToken token = _deployVectorToken(vector.subjectBehavior);
        DomainVaultV1 vault = _deployERC20Vault(keccak256(bytes(vector.caseId)), address(token));

        bool isPull = keccak256(bytes(vector.operation)) == keccak256("pull");
        address sourceAccount;
        address destinationAccount;
        if (isPull) {
            sourceAccount = source;
            destinationAccount = address(vault);
            token.mint(sourceAccount, 1000);
            vm.prank(sourceAccount);
            token.approve(address(vault), 1000);
        } else {
            assertEq(vector.operation, "push");
            sourceAccount = address(vault);
            destinationAccount = recipient;
            token.mint(sourceAccount, 1000);
        }

        uint256 sourceBefore = token.balanceOf(sourceAccount);
        uint256 destinationBefore = token.balanceOf(destinationAccount);
        if (vector.accepted) {
            assertEq(bytes(vector.expectedError).length, 0);
            TransferObservationV1 memory observation = isPull
                ? controller.pullERC20(vault, sourceAccount, vector.amount)
                : controller.pushERC20(vault, destinationAccount, vector.amount);
            assertEq(observation.grossSourceDebit, vector.committedSourceDebit);
            assertEq(observation.spendableDestinationCredit, vector.committedDestinationCredit);
            assertEq(vector.returnBytes, exactReturnBytes);
        } else {
            _expectERC20Revert(vector, address(token), isPull);
            if (isPull) {
                controller.pullERC20(vault, sourceAccount, vector.amount);
            } else {
                controller.pushERC20(vault, destinationAccount, vector.amount);
            }
        }

        assertEq(sourceBefore - token.balanceOf(sourceAccount), vector.committedSourceDebit);
        assertEq(token.balanceOf(destinationAccount) - destinationBefore, vector.committedDestinationCredit);
    }

    function _expectNativeRevert(AssetCase memory vector, address target, uint256 maximumReturnBytes) private {
        bytes32 expectedError = keccak256(bytes(vector.expectedError));
        if (expectedError == keccak256("NativeReturnDataTooLarge")) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    NativeETHProfileV1.NativeReturnDataTooLarge.selector, vector.returnBytes, maximumReturnBytes
                )
            );
        } else if (expectedError == keccak256("NativeTransferFailed")) {
            vm.expectRevert(
                abi.encodeWithSelector(NativeETHProfileV1.NativeTransferFailed.selector, target, vector.amount)
            );
        } else if (expectedError == keccak256("NativeDestinationCreditMismatch")) {
            vm.expectRevert(
                abi.encodeWithSelector(NativeETHProfileV1.NativeDestinationCreditMismatch.selector, vector.amount, 0)
            );
        } else if (expectedError == keccak256("ZeroAmount")) {
            vm.expectRevert(NativeETHProfileV1.ZeroAmount.selector);
        } else {
            revert(string.concat("unknown native error: ", vector.expectedError));
        }
    }

    function _expectERC20Revert(AssetCase memory vector, address token, bool isPull) private {
        bytes32 expectedError = keccak256(bytes(vector.expectedError));
        bytes4 selector = isPull ? TRANSFER_FROM_SELECTOR : TRANSFER_SELECTOR;
        if (expectedError == keccak256("InvalidTokenBoolean")) {
            vm.expectRevert(
                abi.encodeWithSelector(StrictMeasuredERC20ProfileV1.InvalidTokenBoolean.selector, token, selector, 0)
            );
        } else if (expectedError == keccak256("InvalidTokenReturnLength")) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    StrictMeasuredERC20ProfileV1.InvalidTokenReturnLength.selector, token, selector, vector.returnBytes
                )
            );
        } else if (expectedError == keccak256("DestinationCreditMismatch")) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    StrictMeasuredERC20ProfileV1.DestinationCreditMismatch.selector,
                    vector.amount,
                    uint256(vector.amount) - 1
                )
            );
        } else if (expectedError == keccak256("SourceDebitMismatch")) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    StrictMeasuredERC20ProfileV1.SourceDebitMismatch.selector, vector.amount, uint256(vector.amount) + 1
                )
            );
        } else if (expectedError == keccak256("ZeroAmount")) {
            vm.expectRevert(StrictMeasuredERC20ProfileV1.ZeroAmount.selector);
        } else {
            revert(string.concat("unknown ERC-20 error: ", vector.expectedError));
        }
    }

    function _deployVectorToken(string memory behavior) private returns (IAssetVectorToken token) {
        bytes32 behaviorHash = keccak256(bytes(behavior));
        if (behaviorHash == keccak256("strict")) {
            token = IAssetVectorToken(address(new StrictERC20Mock()));
        } else if (behaviorHash == keccak256("false-return")) {
            token = IAssetVectorToken(address(new FalseReturnERC20Mock()));
        } else if (behaviorHash == keccak256("empty-return")) {
            token = IAssetVectorToken(address(new NoReturnERC20Mock()));
        } else if (behaviorHash == keccak256("exact-plus-one-return")) {
            token = IAssetVectorToken(address(new ExactPlusOneReturnERC20Mock()));
        } else if (behaviorHash == keccak256("fee-undercredit")) {
            token = IAssetVectorToken(address(new FeeOnTransferERC20Mock()));
        } else if (behaviorHash == keccak256("overdebit")) {
            token = IAssetVectorToken(address(new OverDebitERC20Mock()));
        } else {
            revert(string.concat("unknown token behavior: ", behavior));
        }
    }

    function _readNativeCase(string memory json, uint256 index) private pure returns (AssetCase memory vector) {
        string memory path = string.concat(".native_eth_cases[", vm.toString(index), "]");
        vector = _readCommonCase(json, path);
        vector.operation = "push";
        vector.subjectBehavior = vm.parseJsonString(json, string.concat(path, ".recipient_behavior"));
    }

    function _readERC20Case(string memory json, uint256 index) private pure returns (AssetCase memory vector) {
        string memory path = string.concat(".strict_measured_erc20_cases[", vm.toString(index), "]");
        vector = _readCommonCase(json, path);
        vector.operation = vm.parseJsonString(json, string.concat(path, ".operation"));
        vector.subjectBehavior = vm.parseJsonString(json, string.concat(path, ".token_behavior"));
    }

    function _readCommonCase(string memory json, string memory path) private pure returns (AssetCase memory vector) {
        vector.accepted = vm.parseJsonBool(json, string.concat(path, ".accepted"));
        uint256 amount = vm.parseJsonUint(json, string.concat(path, ".amount"));
        assertLe(amount, type(uint128).max, "vector amount exceeds native API width");
        // Casting is safe because the vector amount is bounded to uint128 immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        vector.amount = uint128(amount);
        vector.caseId = vm.parseJsonString(json, string.concat(path, ".case_id"));
        vector.committedDestinationCredit = vm.parseJsonUint(json, string.concat(path, ".committed_destination_credit"));
        vector.committedSourceDebit = vm.parseJsonUint(json, string.concat(path, ".committed_source_debit"));
        vector.expectedError = vm.parseJsonString(json, string.concat(path, ".expected_error"));
        vector.returnBytes = vm.parseJsonUint(json, string.concat(path, ".return_bytes"));
    }

    function _deployNativeVault(bytes32 salt) private returns (DomainVaultV1) {
        return
            controller.deployVault(salt, controller.coreDeploymentId(), DOMAIN_REVISION_ID, NATIVE_PROFILE, address(0));
    }

    function _deployERC20Vault(bytes32 salt, address token) private returns (DomainVaultV1) {
        return controller.deployVault(salt, controller.coreDeploymentId(), DOMAIN_REVISION_ID, ERC20_PROFILE, token);
    }
}
