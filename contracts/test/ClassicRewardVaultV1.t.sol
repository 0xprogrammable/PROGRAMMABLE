// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Test } from "forge-std/Test.sol";

import { ClassicCtoAuthorityV1 } from "../src/ClassicCtoAuthorityV1.sol";
import { ClassicRewardVaultFactoryV1 } from "../src/ClassicRewardVaultFactoryV1.sol";
import { ClassicRewardVaultV1 } from "../src/ClassicRewardVaultV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";

contract VaultMockPoolManager {
    function pay(address recipient, uint256 amount) external {
        (bool success,) = recipient.call{ value: amount }("");
        require(success);
    }

    receive() external payable {
        // Test pool manager accepts native settlement.
    }
}

contract VaultMockHook is IClassicFeeHookV3 {
    IPoolManager public immutable override poolManager;
    mapping(bytes32 poolId => uint256 amount) public accrued;

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    function setAccrued(bytes32 poolId, uint256 amount) external {
        accrued[poolId] = amount;
    }

    function creatorFeesAccrued(bytes32 poolId) external view returns (uint256) {
        return accrued[poolId];
    }

    function claimCreatorFees(bytes32 poolId) external returns (uint256 amount) {
        amount = accrued[poolId];
        accrued[poolId] = 0;
        VaultMockPoolManager(payable(address(poolManager))).pay(msg.sender, amount);
    }
}

    contract ClassicRewardVaultV1Test is Test {
        bytes32 internal constant POOL_ID = keccak256("classic-reward-pool");

        ClassicCtoAuthorityV1 internal ctoAuthority;
        ClassicRewardVaultFactoryV1 internal factory;
        VaultMockPoolManager internal manager;
        VaultMockHook internal hook;
        address internal ctoAdmin;

        function setUp() public {
            ctoAdmin = makeAddr("ctoAdmin");
            ctoAuthority = new ClassicCtoAuthorityV1(ctoAdmin);
            factory = new ClassicRewardVaultFactoryV1(ctoAuthority);
            manager = new VaultMockPoolManager();
            hook = new VaultMockHook(IPoolManager(address(manager)));
            vm.deal(address(manager), 100 ether);
        }

        function test_factoryDeploysAtPredictedAddressAndCommitsConfiguration() public {
            address[] memory beneficiaries = _beneficiaries(3);
            uint16[] memory shares = new uint16[](3);
            shares[0] = 2500;
            shares[1] = 2500;
            shares[2] = 5000;
            bytes32 salt = keccak256("vault");

            address predicted = factory.predict(salt, hook, POOL_ID, beneficiaries, shares);
            ClassicRewardVaultV1 vault = factory.deploy(salt, hook, POOL_ID, beneficiaries, shares);
            ClassicRewardVaultV1 reused = factory.deployOrGet(salt, hook, POOL_ID, beneficiaries, shares);

            assertEq(address(vault), predicted);
            assertEq(address(reused), predicted);
            assertTrue(factory.isFactoryVault(predicted));
            assertEq(factory.configurationHashOf(predicted), vault.configurationHash());
            assertEq(address(vault.ctoAuthority()), address(ctoAuthority));
            assertEq(vault.beneficiaryCount(), 3);
            assertEq(vault.configurationEpoch(), 1);
        }

        function test_supportsFiveUnequalRewardAllocations() public {
            address[] memory beneficiaries = _beneficiaries(5);
            uint16[] memory shares = new uint16[](5);
            shares[0] = 5000;
            shares[1] = 2000;
            shares[2] = 1500;
            shares[3] = 1000;
            shares[4] = 500;

            ClassicRewardVaultV1 vault = factory.deploy(bytes32("five"), hook, POOL_ID, beneficiaries, shares);
            assertEq(vault.beneficiaryCount(), 5);
            for (uint256 index; index < 5; index++) {
                assertEq(vault.beneficiaryAt(index), beneficiaries[index]);
                assertEq(vault.shareBpsAt(index), shares[index]);
            }
        }

        function test_rejectsZeroAndMoreThanFiveBeneficiaries() public {
            address[] memory none = new address[](0);
            uint16[] memory noShares = new uint16[](0);
            vm.expectRevert(abi.encodeWithSelector(ClassicRewardVaultV1.InvalidBeneficiaryCount.selector, 0));
            factory.deploy(bytes32("none"), hook, POOL_ID, none, noShares);

            address[] memory six = _beneficiaries(6);
            uint16[] memory shares = new uint16[](6);
            for (uint256 index; index < 5; index++) {
                shares[index] = 1500;
            }
            shares[5] = 2500;
            vm.expectRevert(abi.encodeWithSelector(ClassicRewardVaultV1.InvalidBeneficiaryCount.selector, 6));
            factory.deploy(bytes32("six"), hook, POOL_ID, six, shares);
        }

        function test_rejectsZeroDuplicateAndZeroShareBeneficiaries() public {
            address[] memory beneficiaries = _beneficiaries(2);
            uint16[] memory shares = _shares2(5000, 5000);

            beneficiaries[0] = address(0);
            vm.expectRevert(abi.encodeWithSelector(ClassicRewardVaultV1.InvalidBeneficiary.selector, address(0)));
            factory.deploy(bytes32("zero"), hook, POOL_ID, beneficiaries, shares);

            beneficiaries = _beneficiaries(2);
            beneficiaries[1] = beneficiaries[0];
            vm.expectRevert(
                abi.encodeWithSelector(ClassicRewardVaultV1.DuplicateBeneficiary.selector, beneficiaries[0])
            );
            factory.deploy(bytes32("duplicate"), hook, POOL_ID, beneficiaries, shares);

            beneficiaries = _beneficiaries(2);
            shares[0] = 0;
            shares[1] = 10_000;
            vm.expectRevert(abi.encodeWithSelector(ClassicRewardVaultV1.InvalidShare.selector, beneficiaries[0], 0));
            factory.deploy(bytes32("zero-share"), hook, POOL_ID, beneficiaries, shares);
        }

        function test_rejectsShareTotalOtherThanTenThousand() public {
            address[] memory beneficiaries = _beneficiaries(2);
            uint16[] memory shares = _shares2(4000, 5000);
            vm.expectRevert(abi.encodeWithSelector(ClassicRewardVaultV1.InvalidShareTotal.selector, 9000));
            factory.deploy(bytes32("bad-total"), hook, POOL_ID, beneficiaries, shares);
        }

        function test_acceptsSmartAndCounterfactualWalletBeneficiaries() public {
            address smartWallet = address(new VaultMockPoolManager());
            address counterfactualWallet = address(0x1234567890123456789012345678901234567890);
            ClassicRewardVaultV1 vault = factory.deploy(
                bytes32("wallet-types"),
                hook,
                POOL_ID,
                _addresses2(smartWallet, counterfactualWallet),
                _shares2(5000, 5000)
            );
            assertEq(vault.beneficiaryAt(0), smartWallet);
            assertEq(vault.beneficiaryAt(1), counterfactualWallet);
        }

        function test_roundingRemainderGoesToFinalBeneficiaryWithoutStrandingCreatorFees() public {
            address alice = makeAddr("alice");
            address bob = makeAddr("bob");
            ClassicRewardVaultV1 vault =
                factory.deploy(bytes32("rounding"), hook, POOL_ID, _addresses2(alice, bob), _shares2(5000, 5000));
            hook.setAccrued(POOL_ID, 3);

            vm.prank(alice);
            assertEq(vault.claim(), 1);
            vm.prank(bob);
            assertEq(vault.claim(), 2);

            assertEq(vault.totalCreatorFeesReceived(), 3);
            assertEq(vault.totalCreatorFeesClaimed(), 3);
            assertEq(address(vault).balance, 0);
        }

        /// forge-config: default.fuzz.runs = 10000
        function testFuzz_splitConservationLeavesNoCreatorFeeStranded(uint96 rawAmount, uint16 rawShare) public {
            uint256 amount = bound(uint256(rawAmount), 10_000, 10 ether);
            uint16 firstShare = uint16(bound(uint256(rawShare), 1, 9999));
            address alice = makeAddr("fuzzAlice");
            address bob = makeAddr("fuzzBob");
            bytes32 poolId = keccak256(abi.encode(amount, firstShare));
            ClassicRewardVaultV1 vault =
                factory.deploy(poolId, hook, poolId, _addresses2(alice, bob), _shares2(firstShare, 10_000 - firstShare));
            hook.setAccrued(poolId, amount);

            vm.prank(alice);
            uint256 aliceClaim = vault.claim();
            vm.prank(bob);
            uint256 bobClaim = vault.claim();

            assertEq(aliceClaim + bobClaim, amount);
            assertEq(vault.totalCreatorFeesClaimed(), amount);
            assertEq(address(vault).balance, 0);
        }

        function test_payoutWalletChangeMovesOnlyFutureRewardsAndNeedsNoAcceptance() public {
            address alice = makeAddr("alice");
            address bob = makeAddr("bob");
            address replacement = makeAddr("replacement");
            ClassicRewardVaultV1 vault =
                factory.deploy(bytes32("prospective"), hook, POOL_ID, _addresses2(alice, bob), _shares2(4000, 6000));

            hook.setAccrued(POOL_ID, 10 ether);
            vm.prank(alice);
            vault.changePayoutWallet(0, replacement);

            assertEq(vault.beneficiaryAt(0), replacement);
            assertEq(vault.shareBpsAt(0), 4000);
            assertEq(vault.claimable(alice), 4 ether);
            assertEq(vault.claimable(replacement), 0);
            assertEq(vault.configurationEpoch(), 2);

            hook.setAccrued(POOL_ID, 5 ether);
            vm.prank(replacement);
            assertEq(vault.claim(), 2 ether);
            vm.prank(alice);
            assertEq(vault.claim(), 4 ether);
            vm.prank(bob);
            assertEq(vault.claim(), 9 ether);

            assertEq(replacement.balance, 2 ether);
            assertEq(alice.balance, 4 ether);
            assertEq(bob.balance, 9 ether);
            assertEq(vault.totalCreatorFeesClaimed(), 15 ether);
        }

        function test_onlyCurrentPayoutWalletCanChangeItself() public {
            address owner = makeAddr("owner");
            address attacker = makeAddr("attacker");
            address replacement = makeAddr("replacement");
            ClassicRewardVaultV1 vault =
                factory.deploy(bytes32("authority"), hook, POOL_ID, _addresses1(owner), _shares1(10_000));

            vm.prank(attacker);
            vm.expectRevert(
                abi.encodeWithSelector(
                    ClassicRewardVaultV1.UnauthorizedAllocationOwner.selector, attacker, uint256(0), owner
                )
            );
            vault.changePayoutWallet(0, replacement);

            vm.prank(owner);
            vm.expectRevert(abi.encodeWithSelector(ClassicRewardVaultV1.InvalidBeneficiary.selector, address(0)));
            vault.changePayoutWallet(0, address(0));
        }

        function test_payoutWalletCanConsolidateWithAnExistingPayoutWallet() public {
            address alice = makeAddr("alice");
            address bob = makeAddr("bob");
            ClassicRewardVaultV1 vault =
                factory.deploy(bytes32("consolidate"), hook, POOL_ID, _addresses2(alice, bob), _shares2(4000, 6000));

            vm.prank(alice);
            vault.changePayoutWallet(0, bob);
            assertEq(vault.beneficiaryAt(0), bob);
            assertEq(vault.beneficiaryAt(1), bob);
            assertEq(vault.shareBpsOf(bob), 10_000);

            hook.setAccrued(POOL_ID, 3 ether);
            vm.prank(bob);
            assertEq(vault.claim(), 3 ether);
        }

        function test_ctoReplacesTheCompleteFutureConfigurationWithoutTakingOldRewards() public {
            address alice = makeAddr("alice");
            address bob = makeAddr("bob");
            address carol = makeAddr("carol");
            address ctoWallet = makeAddr("ctoWallet");
            ClassicRewardVaultV1 vault =
                factory.deploy(
                bytes32("cto"), hook, POOL_ID, _addresses3(alice, bob, carol), _shares3(2000, 3000, 5000)
            );

            hook.setAccrued(POOL_ID, 10 ether);
            bytes32 approvalReference = keccak256("approved-cto-application");
            vm.prank(ctoAdmin);
            ctoAuthority.executeCto(vault, _addresses1(ctoWallet), _shares1(10_000), approvalReference);

            assertEq(vault.beneficiaryCount(), 1);
            assertEq(vault.beneficiaryAt(0), ctoWallet);
            assertEq(vault.configurationEpoch(), 2);
            assertEq(vault.claimable(alice), 2 ether);
            assertEq(vault.claimable(bob), 3 ether);
            assertEq(vault.claimable(carol), 5 ether);
            assertEq(vault.claimable(ctoWallet), 0);

            hook.setAccrued(POOL_ID, 4 ether);
            vm.prank(ctoWallet);
            assertEq(vault.claim(), 4 ether);
            vm.prank(alice);
            assertEq(vault.claim(), 2 ether);
            vm.prank(bob);
            assertEq(vault.claim(), 3 ether);
            vm.prank(carol);
            assertEq(vault.claim(), 5 ether);
        }

        function test_ctoCanReplaceOneAllocationWithFiveUnequalAllocations() public {
            address[] memory recipients = _beneficiaries(5);
            uint16[] memory shares = new uint16[](5);
            shares[0] = 5000;
            shares[1] = 2000;
            shares[2] = 1500;
            shares[3] = 1000;
            shares[4] = 500;
            ClassicRewardVaultV1 vault =
                factory.deploy(bytes32("cto-five"), hook, POOL_ID, _addresses1(makeAddr("oldOwner")), _shares1(10_000));

            vm.prank(ctoAdmin);
            ctoAuthority.executeCto(vault, recipients, shares, keccak256("five-way-cto"));

            assertEq(vault.beneficiaryCount(), 5);
            for (uint256 index; index < recipients.length; index++) {
                assertEq(vault.beneficiaryAt(index), recipients[index]);
                assertEq(vault.shareBpsAt(index), shares[index]);
            }
        }

        function test_onlyCtoAuthorityCanReplaceConfigurationAndReferenceCannotBeEmpty() public {
            address owner = makeAddr("owner");
            address replacement = makeAddr("replacement");
            address attacker = makeAddr("attacker");
            ClassicRewardVaultV1 vault =
                factory.deploy(bytes32("cto-auth"), hook, POOL_ID, _addresses1(owner), _shares1(10_000));

            vm.prank(attacker);
            vm.expectRevert(
                abi.encodeWithSelector(ClassicCtoAuthorityV1.UnauthorizedAuthority.selector, attacker, ctoAdmin)
            );
            ctoAuthority.executeCto(vault, _addresses1(replacement), _shares1(10_000), keccak256("attack"));

            vm.prank(ctoAdmin);
            vm.expectRevert(ClassicRewardVaultV1.InvalidCtoApprovalReference.selector);
            ctoAuthority.executeCto(vault, _addresses1(replacement), _shares1(10_000), bytes32(0));
        }

        function test_ctoAuthorityMovesThroughTwoStepAcceptance() public {
            address nextAuthority = makeAddr("nextAuthority");
            address replacement = makeAddr("replacement");
            ClassicRewardVaultV1 vault = factory.deploy(
                bytes32("cto-transfer"), hook, POOL_ID, _addresses1(makeAddr("oldOwner")), _shares1(10_000)
            );

            vm.prank(ctoAdmin);
            ctoAuthority.proposeAuthority(nextAuthority);
            assertEq(ctoAuthority.pendingAuthority(), nextAuthority);

            vm.prank(nextAuthority);
            ctoAuthority.acceptAuthority();
            assertEq(ctoAuthority.authority(), nextAuthority);
            assertEq(ctoAuthority.pendingAuthority(), address(0));

            vm.prank(ctoAdmin);
            vm.expectRevert(
                abi.encodeWithSelector(ClassicCtoAuthorityV1.UnauthorizedAuthority.selector, ctoAdmin, nextAuthority)
            );
            ctoAuthority.executeCto(vault, _addresses1(replacement), _shares1(10_000), keccak256("old-admin"));

            vm.prank(nextAuthority);
            ctoAuthority.executeCto(vault, _addresses1(replacement), _shares1(10_000), keccak256("new-admin"));
            assertEq(vault.beneficiaryAt(0), replacement);
        }

        function test_claimCannotCrossPoolVaultBoundaries() public {
            address beneficiary = makeAddr("sharedBeneficiary");
            bytes32 poolA = keccak256("pool-a");
            bytes32 poolB = keccak256("pool-b");
            ClassicRewardVaultV1 vaultA =
                factory.deploy(bytes32("vault-a"), hook, poolA, _addresses1(beneficiary), _shares1(10_000));
            ClassicRewardVaultV1 vaultB =
                factory.deploy(bytes32("vault-b"), hook, poolB, _addresses1(beneficiary), _shares1(10_000));
            hook.setAccrued(poolA, 1 ether);
            hook.setAccrued(poolB, 2 ether);

            vm.prank(beneficiary);
            assertEq(vaultA.claim(), 1 ether);
            assertEq(hook.accrued(poolB), 2 ether);
            assertEq(vaultB.totalCreatorFeesReceived(), 0);

            vm.prank(beneficiary);
            assertEq(vaultB.claim(), 2 ether);
            assertEq(beneficiary.balance, 3 ether);
        }

        function _beneficiaries(uint256 count) private pure returns (address[] memory values) {
            values = new address[](count);
            for (uint256 index; index < count; index++) {
                values[index] = address(uint160(index + 1));
            }
        }

        function _addresses1(address a) private pure returns (address[] memory values) {
            values = new address[](1);
            values[0] = a;
        }

        function _shares1(uint16 a) private pure returns (uint16[] memory values) {
            values = new uint16[](1);
            values[0] = a;
        }

        function _addresses2(address a, address b) private pure returns (address[] memory values) {
            values = new address[](2);
            values[0] = a;
            values[1] = b;
        }

        function _shares2(uint16 a, uint16 b) private pure returns (uint16[] memory values) {
            values = new uint16[](2);
            values[0] = a;
            values[1] = b;
        }

        function _addresses3(address a, address b, address c) private pure returns (address[] memory values) {
            values = new address[](3);
            values[0] = a;
            values[1] = b;
            values[2] = c;
        }

        function _shares3(uint16 a, uint16 b, uint16 c) private pure returns (uint16[] memory values) {
            values = new uint16[](3);
            values[0] = a;
            values[1] = b;
            values[2] = c;
        }
    }
