// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import {
    ClassicInitialBuyCustodyConfig,
    ClassicInitialBuyCustodyMode,
    ClassicInitialBuyVestingWalletV1
} from "../src/ClassicInitialBuyVestingWalletV1.sol";
import { ClassicInitialBuyVestingWalletFactoryV1 } from "../src/ClassicInitialBuyVestingWalletFactoryV1.sol";

contract ClassicInitialBuyVestingWalletV1Test is Test {
    uint256 internal constant ALLOCATION = 1_000_000 ether;

    ClassicInitialBuyVestingWalletFactoryV1 internal factory;
    MockERC20 internal token;
    address internal beneficiary;
    address internal attacker;

    function setUp() public {
        factory = new ClassicInitialBuyVestingWalletFactoryV1();
        token = new MockERC20("Classic Initial Buy", "CIB", 18);
        beneficiary = makeAddr("beneficiary");
        attacker = makeAddr("attacker");
        vm.warp(1_800_000_000);
    }

    function test_fixedLockReleasesEverythingOnlyAfterTheReleaseDay() public {
        ClassicInitialBuyCustodyConfig memory config = _config(ClassicInitialBuyCustodyMode.FixedLock, 30, 0);
        ClassicInitialBuyVestingWalletV1 wallet = _deploy(bytes32("fixed"), config);
        token.mint(address(wallet), ALLOCATION);

        assertEq(wallet.owner(), beneficiary);
        assertEq(wallet.start(), block.timestamp + 30 days);
        assertEq(wallet.end(), block.timestamp + 30 days);
        assertEq(wallet.releasable(address(token)), 0);

        vm.warp(block.timestamp + 30 days - 1);
        assertEq(wallet.releasable(address(token)), 0);
        vm.warp(block.timestamp + 1);
        assertEq(wallet.releasable(address(token)), ALLOCATION);

        vm.prank(beneficiary);
        wallet.release(address(token));
        assertEq(token.balanceOf(beneficiary), ALLOCATION);
        assertEq(token.balanceOf(address(wallet)), 0);
    }

    function test_linearVestingReleasesProRataFromLaunchUntilEnd() public {
        uint64 launchTimestamp = uint64(block.timestamp);
        ClassicInitialBuyCustodyConfig memory config = _config(ClassicInitialBuyCustodyMode.LinearVesting, 100, 0);
        ClassicInitialBuyVestingWalletV1 wallet = _deploy(bytes32("linear"), config);
        token.mint(address(wallet), ALLOCATION);

        vm.warp(uint256(launchTimestamp) + 25 days);
        assertEq(wallet.releasable(address(token)), ALLOCATION / 4);
        vm.prank(beneficiary);
        wallet.release(address(token));
        assertEq(token.balanceOf(beneficiary), ALLOCATION / 4);

        vm.warp(uint256(launchTimestamp) + 100 days);
        vm.prank(beneficiary);
        wallet.release(address(token));
        assertEq(token.balanceOf(beneficiary), ALLOCATION);
    }

    function test_cliffThenLinearStartsAtZeroAndReachesFullAllocationAtEnd() public {
        uint64 launchTimestamp = uint64(block.timestamp);
        ClassicInitialBuyCustodyConfig memory config = _config(ClassicInitialBuyCustodyMode.CliffLinearVesting, 100, 20);
        ClassicInitialBuyVestingWalletV1 wallet = _deploy(bytes32("cliff"), config);
        token.mint(address(wallet), ALLOCATION);

        assertEq(wallet.start(), uint256(launchTimestamp) + 20 days);
        assertEq(wallet.end(), uint256(launchTimestamp) + 100 days);
        vm.warp(uint256(launchTimestamp) + 20 days);
        assertEq(wallet.releasable(address(token)), 0);

        vm.warp(uint256(launchTimestamp) + 60 days);
        assertEq(wallet.releasable(address(token)), ALLOCATION / 2);
        vm.prank(beneficiary);
        wallet.release(address(token));
        assertEq(token.balanceOf(beneficiary), ALLOCATION / 2);

        vm.warp(uint256(launchTimestamp) + 100 days);
        vm.prank(beneficiary);
        wallet.release(address(token));
        assertEq(token.balanceOf(beneficiary), ALLOCATION);
    }

    function test_onlyImmutableBeneficiaryCanReleaseOrAttemptOwnershipChanges() public {
        ClassicInitialBuyVestingWalletV1 wallet =
            _deploy(bytes32("immutable"), _config(ClassicInitialBuyCustodyMode.LinearVesting, 30, 0));
        token.mint(address(wallet), ALLOCATION);
        vm.warp(block.timestamp + 30 days);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        wallet.release(address(token));

        vm.prank(beneficiary);
        vm.expectRevert(ClassicInitialBuyVestingWalletV1.ImmutableBeneficiary.selector);
        wallet.transferOwnership(attacker);

        vm.prank(beneficiary);
        vm.expectRevert(ClassicInitialBuyVestingWalletV1.ImmutableBeneficiary.selector);
        wallet.renounceOwnership();

        assertEq(wallet.owner(), beneficiary);
        assertEq(token.balanceOf(address(wallet)), ALLOCATION);
    }

    function test_factoryAddressAndConfigurationAreDeterministicAndAuthenticated() public {
        ClassicInitialBuyCustodyConfig memory config =
            _config(ClassicInitialBuyCustodyMode.CliffLinearVesting, 3650, 365);
        bytes32 salt = keccak256("deterministic");
        uint64 launchTimestamp = uint64(block.timestamp);
        address predicted = factory.predict(salt, IERC20(address(token)), beneficiary, launchTimestamp, config);
        ClassicInitialBuyVestingWalletV1 wallet =
            factory.deploy(salt, IERC20(address(token)), beneficiary, launchTimestamp, config);
        ClassicInitialBuyVestingWalletV1 reused =
            factory.deployOrGet(salt, IERC20(address(token)), beneficiary, launchTimestamp, config);

        assertEq(address(wallet), predicted);
        assertEq(address(reused), predicted);
        assertTrue(factory.isFactoryWallet(predicted));
        assertEq(factory.configurationHashOf(predicted), wallet.configurationHash());
        assertEq(address(wallet.initialBuyToken()), address(token));
        assertEq(uint8(wallet.custodyMode()), uint8(ClassicInitialBuyCustodyMode.CliffLinearVesting));
        assertEq(wallet.launchTimestamp(), launchTimestamp);
        assertEq(wallet.durationDays(), 3650);
        assertEq(wallet.cliffDays(), 365);
    }

    function test_deployOrGetRejectsCodeThatWasNotAuthenticatedByTheFactory() public {
        ClassicInitialBuyCustodyConfig memory config = _config(ClassicInitialBuyCustodyMode.FixedLock, 30, 0);
        bytes32 salt = keccak256("impostor");
        uint64 launchTimestamp = uint64(block.timestamp);
        address predicted = factory.predict(salt, IERC20(address(token)), beneficiary, launchTimestamp, config);
        vm.etch(predicted, hex"00");

        vm.expectRevert(
            abi.encodeWithSelector(
                ClassicInitialBuyVestingWalletFactoryV1.UnrecognizedFactoryDeployment.selector, predicted
            )
        );
        factory.deployOrGet(salt, IERC20(address(token)), beneficiary, launchTimestamp, config);
    }

    function test_rejectsInvalidSchedulesAndUnlockedDeployment() public {
        _expectInvalid(_config(ClassicInitialBuyCustodyMode.Unlocked, 1, 0));
        _expectInvalid(_config(ClassicInitialBuyCustodyMode.FixedLock, 0, 0));
        _expectInvalid(_config(ClassicInitialBuyCustodyMode.FixedLock, 3651, 0));
        _expectInvalid(_config(ClassicInitialBuyCustodyMode.FixedLock, 30, 1));
        _expectInvalid(_config(ClassicInitialBuyCustodyMode.LinearVesting, 30, 1));
        _expectInvalid(_config(ClassicInitialBuyCustodyMode.CliffLinearVesting, 30, 0));
        _expectInvalid(_config(ClassicInitialBuyCustodyMode.CliffLinearVesting, 30, 30));

        ClassicInitialBuyCustodyConfig memory unlocked = _config(ClassicInitialBuyCustodyMode.Unlocked, 0, 0);
        factory.validateConfig(unlocked);
        vm.expectRevert(ClassicInitialBuyVestingWalletFactoryV1.CustodyNotRequired.selector);
        factory.deploy(bytes32("unlocked"), IERC20(address(token)), beneficiary, uint64(block.timestamp), unlocked);
    }

    function _expectInvalid(ClassicInitialBuyCustodyConfig memory config) private {
        vm.expectRevert();
        factory.validateConfig(config);
    }

    function _deploy(bytes32 salt, ClassicInitialBuyCustodyConfig memory config)
        private
        returns (ClassicInitialBuyVestingWalletV1)
    {
        return factory.deploy(salt, IERC20(address(token)), beneficiary, uint64(block.timestamp), config);
    }

    function _config(ClassicInitialBuyCustodyMode mode, uint16 durationDays, uint16 cliffDays)
        private
        pure
        returns (ClassicInitialBuyCustodyConfig memory)
    {
        return ClassicInitialBuyCustodyConfig({ mode: mode, durationDays: durationDays, cliffDays: cliffDays });
    }
}
