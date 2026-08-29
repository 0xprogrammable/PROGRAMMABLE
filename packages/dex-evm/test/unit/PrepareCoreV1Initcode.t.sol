// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { CoreV1 } from "../../src/core/CoreV1.sol";
import { PrepareCoreV1Initcode } from "../../script/PrepareCoreV1Initcode.s.sol";

contract PrepareCoreV1InitcodeTest is Test {
    PrepareCoreV1Initcode internal helper;

    function setUp() external {
        helper = new PrepareCoreV1Initcode();
    }

    function test_explicitInputsProduceExactDeterministicInitcode() external view {
        bytes32 constitutionId = keccak256("explicit constitution");
        address collector = address(0xC011EC70);
        (bytes memory initcode, bytes32 initcodeHash) = helper.prepare(constitutionId, collector);
        bytes memory expected = bytes.concat(type(CoreV1).creationCode, abi.encode(constitutionId, collector));
        assertEq(initcode, expected);
        assertEq(initcodeHash, keccak256(expected));
        assertEq(helper.STATUS(), keccak256("DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR_V1"));
    }

    function test_refusesToChooseMissingConstitutionOrCollector() external {
        vm.expectRevert(PrepareCoreV1Initcode.ZeroConstitutionId.selector);
        helper.prepare(bytes32(0), address(1));
        vm.expectRevert(PrepareCoreV1Initcode.ZeroCollector.selector);
        helper.prepare(bytes32(uint256(1)), address(0));
    }
}
