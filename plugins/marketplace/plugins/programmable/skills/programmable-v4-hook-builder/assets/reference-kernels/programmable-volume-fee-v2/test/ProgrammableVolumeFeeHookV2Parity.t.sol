// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableVolumeFeeHookV2Erc20Fixture } from "./helpers/ProgrammableVolumeFeeHookV2Erc20Fixture.sol";

contract ProgrammableVolumeFeeHookV2ParityTest is ProgrammableVolumeFeeHookV2Erc20Fixture {
    function setUp() public {
        _setUpErc20Pool();
    }

    function testCheckedInVectorsMatchSolidityFeeMathExactly() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/fee-policy-v2-vectors.json"));
        uint256[] memory gross = vm.parseJsonUintArray(json, ".grossQuoteAmount");
        uint256[] memory selected = vm.parseJsonUintArray(json, ".selectedTotalRate");
        uint256[] memory platformRemainder = vm.parseJsonUintArray(json, ".platformRemainder");
        uint256[] memory projectRemainder = vm.parseJsonUintArray(json, ".projectRemainder");
        uint256[] memory totalFee = vm.parseJsonUintArray(json, ".totalFee");
        uint256[] memory projectFee = vm.parseJsonUintArray(json, ".projectFee");
        uint256[] memory platformFee = vm.parseJsonUintArray(json, ".platformFee");
        uint256[] memory nextProjectRemainder = vm.parseJsonUintArray(json, ".nextProjectRemainder");
        uint256[] memory nextPlatformRemainder = vm.parseJsonUintArray(json, ".nextPlatformRemainder");
        uint256[] memory ready = vm.parseJsonUintArray(json, ".atomicGrossFundingSufficient");

        uint256 vectorCount = gross.length;
        assertEq(selected.length, vectorCount);
        assertEq(platformRemainder.length, vectorCount);
        assertEq(projectRemainder.length, vectorCount);
        assertEq(totalFee.length, vectorCount);
        assertEq(projectFee.length, vectorCount);
        assertEq(platformFee.length, vectorCount);
        assertEq(nextProjectRemainder.length, vectorCount);
        assertEq(nextPlatformRemainder.length, vectorCount);
        assertEq(ready.length, vectorCount);

        for (uint256 index; index < vectorCount; ++index) {
            (
                uint256 actualTotal,
                uint256 actualProject,
                uint256 actualPlatform,
                uint256 actualNextProjectRemainder,
                uint256 actualNextPlatformRemainder,
                bool actualReady
            ) = erc20Hook.previewGrossFees(
                gross[index], uint32(selected[index]), platformRemainder[index], projectRemainder[index]
            );
            assertEq(actualTotal, totalFee[index], "total fee vector mismatch");
            assertEq(actualProject, projectFee[index], "project fee vector mismatch");
            assertEq(actualPlatform, platformFee[index], "platform fee vector mismatch");
            assertEq(actualNextProjectRemainder, nextProjectRemainder[index], "next project remainder vector mismatch");
            assertEq(
                actualNextPlatformRemainder, nextPlatformRemainder[index], "next platform remainder vector mismatch"
            );
            assertEq(actualReady, ready[index] == 1, "atomic funding vector mismatch");
        }
    }
}
