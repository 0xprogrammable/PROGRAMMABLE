// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableShardsDirectInitializerV1 } from "../src/ProgrammableShardsDirectInitializerV1.sol";

contract ShardsInitializerHookMock {
    address public nft;
    bool public initialised;

    function setNFT(address nft_) external {
        nft = nft_;
    }

    function initialise() external returns (uint128 liquidity) {
        initialised = true;
        return 1;
    }
}

contract ShardsInitializerNftMock {
    address public immutable hook;

    constructor(address hook_) {
        hook = hook_;
    }
}

contract ShardsInitializerWrongNftMock {
    function hook() external pure returns (address) {
        return address(0xdead);
    }
}

contract ShardsInitializerGraphFactoryHarness {
    function deploy() external returns (ProgrammableShardsDirectInitializerV1 initializer) {
        initializer = new ProgrammableShardsDirectInitializerV1();
    }

    function initialize(ProgrammableShardsDirectInitializerV1 initializer, address hook, address nft) external {
        initializer.initialize(hook, nft);
    }
}

contract ProgrammableShardsDirectInitializerV1Test is Test {
    ShardsInitializerGraphFactoryHarness internal graphFactory;
    ProgrammableShardsDirectInitializerV1 internal initializer;
    ShardsInitializerHookMock internal hook;
    ShardsInitializerNftMock internal nft;

    function setUp() public {
        graphFactory = new ShardsInitializerGraphFactoryHarness();
        initializer = graphFactory.deploy();
        hook = new ShardsInitializerHookMock();
        nft = new ShardsInitializerNftMock(address(hook));
    }

    function test_initializeWiresAndInitialisesExactlyOnce() public {
        assertEq(initializer.graphFactory(), address(graphFactory));

        graphFactory.initialize(initializer, address(hook), address(nft));

        assertTrue(initializer.consumed());
        assertEq(initializer.hook(), address(hook));
        assertEq(initializer.nft(), address(nft));
        assertEq(hook.nft(), address(nft));
        assertTrue(hook.initialised());
        assertEq(nft.hook(), address(hook));

        vm.expectRevert(ProgrammableShardsDirectInitializerV1.AlreadyConsumed.selector);
        graphFactory.initialize(initializer, address(hook), address(nft));
    }

    function test_initializeRejectsAnyCallerOtherThanDeployingGraphFactory() public {
        vm.expectRevert(ProgrammableShardsDirectInitializerV1.Unauthorized.selector);
        initializer.initialize(address(hook), address(nft));
    }

    function test_initializeRejectsTargetsWithoutCode() public {
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableShardsDirectInitializerV1.TargetHasNoCode.selector, address(0x1234))
        );
        graphFactory.initialize(initializer, address(0x1234), address(nft));

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableShardsDirectInitializerV1.TargetHasNoCode.selector, address(0x5678))
        );
        graphFactory.initialize(initializer, address(hook), address(0x5678));
    }

    function test_initializeRevertsAllStateWhenPostconditionFails() public {
        ShardsInitializerWrongNftMock wrongNft = new ShardsInitializerWrongNftMock();

        vm.expectRevert(ProgrammableShardsDirectInitializerV1.PostconditionFailed.selector);
        graphFactory.initialize(initializer, address(hook), address(wrongNft));

        assertFalse(initializer.consumed());
        assertEq(initializer.hook(), address(0));
        assertEq(initializer.nft(), address(0));
        assertEq(hook.nft(), address(0));
        assertFalse(hook.initialised());
    }
}
