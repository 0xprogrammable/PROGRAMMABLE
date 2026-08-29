// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { CoreV1 } from "../../src/core/CoreV1.sol";

/// @notice Foundations-only integration assertions at a checked Robinhood Chain Testnet identity and local fork head.
/// @dev The invoking gate checks the `finalized` tag read-only, then mutates only a localhost Anvil fork of the current
///      public head. This source-level lane uses cheatcodes to mirror that disposable context without a redundant
///      nested fork. It never signs, broadcasts to Robinhood Chain, or claims finality, deployment, or conformance.
contract RobinhoodTestnetForkFoundationsTest is Test {
    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
    bytes32 internal constant CONSTITUTION_ID = 0x2715d9770de7b327c054c413a99f7cbba0933f2eabc9639a53948706237cd301;
    address internal constant LOCAL_TEST_COLLECTOR = address(0xC011EC70);

    CoreV1 internal core;

    function setUp() external {
        uint256 expectedForkBlock = vm.envUint("PROGRAMMABLE_DEX_EXPECTED_FORK_BLOCK");
        vm.chainId(ROBINHOOD_TESTNET_CHAIN_ID);
        vm.roll(expectedForkBlock);
        assertEq(block.chainid, ROBINHOOD_TESTNET_CHAIN_ID, "local fork chain identity drift");
        assertEq(block.number, expectedForkBlock, "local fork head drift");

        core = new CoreV1(CONSTITUTION_ID, LOCAL_TEST_COLLECTOR);
    }

    function test_localForkDeployAndImmutableReadback() external view {
        bytes32 deploymentTypehash = keccak256(
            "CoreDeploymentV1(bytes32 runtimeId,uint256 chainId,address core,bytes32 constitutionId,uint32 coreMajor,address collector)"
        );
        bytes32 expectedDeploymentId = keccak256(
            abi.encode(
                deploymentTypehash,
                keccak256("programmable.runtime.evm.v1"),
                ROBINHOOD_TESTNET_CHAIN_ID,
                address(core),
                CONSTITUTION_ID,
                uint32(1),
                LOCAL_TEST_COLLECTOR
            )
        );

        assertTrue(address(core).code.length != 0, "local Core has no runtime code");
        assertEq(core.CONSTITUTION_ID(), CONSTITUTION_ID);
        assertEq(core.COLLECTOR(), LOCAL_TEST_COLLECTOR);
        assertEq(core.CORE_MAJOR(), 1);
        assertEq(core.DEPLOYMENT_CHAIN_ID(), ROBINHOOD_TESTNET_CHAIN_ID);
        assertEq(core.CORE_DEPLOYMENT_ID(), expectedDeploymentId);
        assertEq(core.currentRuntimeCodeHash(), address(core).codehash);
        assertEq(uint256(core.executionPhase()), 0, "local Core did not start IDLE");
        assertEq(CoreV1.executeProtected.selector, bytes4(0x4db45c81));
        assertEq(CoreV1.BlockedBySpec.selector, bytes4(0x0ae394a3));
    }

    /// Threat: actor=untrusted router; authority=opaque bytes and attached ETH; pre=Draft grammar and IDLE Core;
    /// attempt=protected execution; expected=exact BLOCKED_BY_SPEC revert; protected post-state=no value retained,
    /// no phase committed, and immutable identity/code unchanged.
    function test_localForkProtectedExecutionRevertsAtomically() external {
        bytes32 deploymentIdBefore = core.CORE_DEPLOYMENT_ID();
        bytes32 runtimeCodeHashBefore = core.currentRuntimeCodeHash();
        uint256 callerBalanceBefore = 1 ether;
        vm.deal(address(this), callerBalanceBefore);

        vm.expectRevert(
            abi.encodeWithSelector(CoreV1.BlockedBySpec.selector, core.DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR())
        );
        core.executeProtected{ value: 1 wei }(hex"deadbeef");

        assertEq(address(this).balance, callerBalanceBefore, "reverted value was not restored");
        assertEq(address(core).balance, 0, "blocked execution retained value");
        assertEq(uint256(core.executionPhase()), 0, "blocked execution committed a phase");
        assertEq(core.CORE_DEPLOYMENT_ID(), deploymentIdBefore, "blocked execution changed identity");
        assertEq(core.currentRuntimeCodeHash(), runtimeCodeHashBefore, "blocked execution changed code");
    }
}
