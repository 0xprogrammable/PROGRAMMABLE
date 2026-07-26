// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";

contract PositionManagerCodeStub { }

contract LockedPositionFeeForwarderFactoryV1Test is Test {
    IPositionManager internal positionManager;
    LockedPositionFeeForwarderFactoryV1 internal factory;
    address internal creator;

    function setUp() public {
        positionManager = IPositionManager(address(new PositionManagerCodeStub()));
        factory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        creator = makeAddr("launchCreator");
    }

    function test_deploysOfficialForwarderWithFixedLockPolicy() public {
        bytes32 salt = keccak256("launch-1");
        address predicted = factory.predict(salt, creator);

        PositionFeesForwarder forwarder = factory.deploy(salt, creator);

        assertEq(address(forwarder), predicted);
        assertEq(address(forwarder.positionManager()), address(positionManager));
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        assertTrue(factory.isFactoryForwarder(address(forwarder)));

        bytes32 expectedConfigurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(factory),
                address(forwarder),
                address(positionManager),
                address(0),
                type(uint256).max,
                creator
            )
        );
        assertEq(factory.configurationHashOf(address(forwarder)), expectedConfigurationHash);
    }

    function test_revertsBeforeMaximumTimelockBlock() public {
        PositionFeesForwarder forwarder = factory.deploy(keccak256("launch-2"), creator);

        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();
    }

    function test_rejectsDuplicateDeployment() public {
        bytes32 salt = keccak256("launch-3");
        address predicted = factory.predict(salt, creator);
        factory.deploy(salt, creator);

        vm.expectRevert(
            abi.encodeWithSelector(LockedPositionFeeForwarderFactoryV1.ForwarderAlreadyDeployed.selector, predicted)
        );
        factory.deploy(salt, creator);
    }

    function test_rejectsInvalidFeeRecipients() public {
        address[3] memory invalid = [address(0), address(1), address(2)];

        for (uint256 i = 0; i < invalid.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(PositionFeesForwarder.InvalidFeeRecipient.selector, invalid[i]));
            factory.deploy(bytes32(i), invalid[i]);
        }
    }

    function test_rejectsMissingPositionManagerCode() public {
        vm.expectRevert(
            abi.encodeWithSelector(LockedPositionFeeForwarderFactoryV1.InvalidPositionManager.selector, address(0))
        );
        new LockedPositionFeeForwarderFactoryV1(IPositionManager(address(0)));

        address noCode = makeAddr("noCodePositionManager");
        vm.expectRevert(
            abi.encodeWithSelector(LockedPositionFeeForwarderFactoryV1.InvalidPositionManager.selector, noCode)
        );
        new LockedPositionFeeForwarderFactoryV1(IPositionManager(noCode));
    }

    function test_predictionIsBoundToFeeRecipient() public {
        bytes32 salt = keccak256("launch-4");
        assertNotEq(factory.predict(salt, creator), factory.predict(salt, makeAddr("otherCreator")));
    }
}
