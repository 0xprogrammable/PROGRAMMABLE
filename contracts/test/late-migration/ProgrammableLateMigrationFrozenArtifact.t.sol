// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ProgrammableLateMigrationIntakeV3 } from "../../src/late-migration/ProgrammableLateMigrationIntakeV3.sol";
import { PinnedPermitTokenMockV3 } from "./mocks/IntakeV3Mocks.sol";

/// @dev Rebuilds every leaf and aggregate from the shipped config against the production contract.
///      No test-root override is used, and no onchain holding history is inferred from this artifact.
contract ProgrammableLateMigrationFrozenArtifactTest is Test {
    struct FrozenRow {
        uint256 offerIndex;
        uint256 requiredGrossDepositRaw;
        address sourceAddress;
        uint256 targetPayout80Raw;
    }

    function testAllFrozenRowsMatchProductionRootAndPerWalletTotals() public {
        vm.chainId(1);
        address token = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
        vm.etch(token, address(new PinnedPermitTokenMockV3()).code);
        ProgrammableLateMigrationIntakeV3 intake = new ProgrammableLateMigrationIntakeV3(address(this));
        string memory path = string.concat(vm.projectRoot(), "/../config/late-migration-eligibility.v1.json");
        string memory json = vm.readFile(path);
        FrozenRow[] memory rows = abi.decode(
            vm.parseJsonTypeArray(
                json,
                ".rows",
                "FrozenRow(uint256 offerIndex,uint256 requiredGrossDepositRaw,address sourceAddress,uint256 targetPayout80Raw)"
            ),
            (FrozenRow[])
        );
        assertEq(rows.length, intake.ELIGIBLE_OFFER_COUNT());
        bytes32[] memory leaves = new bytes32[](rows.length);
        uint256 grossTotal;
        uint256 payoutTotal;
        for (uint256 i; i < rows.length; ++i) {
            FrozenRow memory row = rows[i];
            assertEq(row.offerIndex, i);
            if (i > 0) assertGt(uint160(row.sourceAddress), uint160(rows[i - 1].sourceAddress));
            uint256 gross = row.requiredGrossDepositRaw;
            uint256 payout = row.targetPayout80Raw;
            assertGt(payout, 0);
            assertEq(payout, (gross / 5) * 4 + (gross % 5) * 4 / 5);
            grossTotal += gross;
            payoutTotal += payout;
            leaves[i] = intake.leafHash(ProgrammableLateMigrationIntakeV3.Offer(i, row.sourceAddress, gross, payout));
        }
        assertEq(grossTotal, intake.MAXIMUM_GROSS_AMOUNT());
        assertEq(payoutTotal, intake.MAXIMUM_PAYOUT_AMOUNT());
        assertEq(intake.expectedPayout(grossTotal) - payoutTotal, 594);
        _sort(leaves, int256(0), int256(leaves.length - 1));
        bytes32[] memory tree = new bytes32[](leaves.length * 2 - 1);
        for (uint256 i; i < leaves.length; ++i) {
            tree[tree.length - 1 - i] = leaves[i];
        }
        for (uint256 i = leaves.length - 1; i > 0;) {
            --i;
            bytes32 left = tree[2 * i + 1];
            bytes32 right = tree[2 * i + 2];
            tree[i] = left < right ? keccak256(abi.encodePacked(left, right)) : keccak256(abi.encodePacked(right, left));
        }
        assertEq(tree[0], intake.eligibilityRoot());
        assertEq(tree[0], intake.ELIGIBILITY_ROOT());
    }

    function _sort(bytes32[] memory values, int256 left, int256 right) private pure {
        int256 i = left;
        int256 j = right;
        bytes32 pivot = values[uint256(left + (right - left) / 2)];
        while (i <= j) {
            while (values[uint256(i)] < pivot) ++i;
            while (values[uint256(j)] > pivot) --j;
            if (i <= j) {
                (values[uint256(i)], values[uint256(j)]) = (values[uint256(j)], values[uint256(i)]);
                ++i;
                --j;
            }
        }
        if (left < j) _sort(values, left, j);
        if (i < right) _sort(values, i, right);
    }
}
