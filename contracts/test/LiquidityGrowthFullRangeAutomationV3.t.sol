// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

import { LiquidityGrowthFullRangeAutomationV3 } from "../src/LiquidityGrowthFullRangeAutomationV3.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../src/LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthFullRangeV3Fixture } from "./utils/LiquidityGrowthFullRangeV3Fixture.sol";

contract LiquidityGrowthFullRangeAutomationV3Test is LiquidityGrowthFullRangeV3Fixture {
    LiquidityGrowthFullRangeAutomationV3 private automation;

    function setUp() public override {
        super.setUp();
        automation = new LiquidityGrowthFullRangeAutomationV3(v3VaultFactory, address(this));
        automation.registerAndStageOracle(address(v3Vault));
    }

    function test_registrationIsLauncherOnlyIdempotentAndFactoryBound() public {
        assertTrue(automation.isRegisteredVault(address(v3Vault)));
        assertEq(automation.registeredVaultCount(), 1);
        assertEq(automation.registeredVaultAt(0), address(v3Vault));

        automation.registerAndStageOracle(address(v3Vault));
        assertEq(automation.registeredVaultCount(), 1);

        vm.prank(makeAddr("notLauncher"));
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeAutomationV3.UnauthorizedLauncher.selector, makeAddr("notLauncher")
            )
        );
        automation.registerAndStageOracle(address(v3Vault));

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeAutomationV3.UnrecognizedVault.selector, makeAddr("notFactoryVault")
            )
        );
        automation.stageOracle(makeAddr("notFactoryVault"));
    }

    function test_permissionlessStagingThenAtomicCompoundUsesOnlyVaultPolicy() public {
        assertEq(
            uint8(automation.assessVault(address(v3Vault))),
            uint8(LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle)
        );
        _stageToTarget();
        assertEq(
            uint8(automation.assessVault(address(v3Vault))), uint8(LiquidityGrowthFullRangeAutomationV3.Action.None)
        );

        vm.warp(block.timestamp + Policy.TWAP_WINDOW);
        vm.roll(block.number + 150);
        assertEq(
            uint8(automation.assessVault(address(v3Vault))), uint8(LiquidityGrowthFullRangeAutomationV3.Action.Compound)
        );

        address keeper = makeAddr("permissionlessKeeper");
        uint256 nonceBefore = v3Vault.compoundNonce();
        vm.prank(keeper);
        (bool succeeded, LiquidityGrowthFullRangeAutomationV3.Action action) = automation.performVault(address(v3Vault));

        assertTrue(succeeded);
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeAutomationV3.Action.Compound));
        assertEq(v3Vault.compoundNonce(), nonceBefore + 1);
        assertEq(v3Vault.lastCompoundTimestamp(), block.timestamp);
        assertGt(v3Vault.lockedLiquidity(), 0);
    }

    function test_batchesAndScansIgnoreUnrecognizedVaultsWithoutBlockingValidWork() public {
        address impostor = makeAddr("automationImpostor");
        address[] memory candidates = new address[](2);
        candidates[0] = impostor;
        candidates[1] = address(v3Vault);

        LiquidityGrowthFullRangeAutomationV3.Work[] memory ready = automation.checkBatch(candidates);
        assertEq(ready.length, 1);
        assertEq(ready[0].vault, address(v3Vault));
        assertEq(uint8(ready[0].action), uint8(LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle));

        (LiquidityGrowthFullRangeAutomationV3.Work[] memory scanned, uint256 nextCursor) = automation.scan(0, 1);
        assertEq(scanned.length, 1);
        assertEq(scanned[0].vault, address(v3Vault));
        assertEq(nextCursor, 0);

        (uint256 attempted, uint256 succeeded) = automation.stageOracleBatch(candidates);
        assertEq(attempted, 2);
        assertEq(succeeded, 1);
    }

    function test_batchLimitFailsBeforeExternalWork() public {
        address[] memory candidates = new address[](automation.MAX_BATCH_SIZE() + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeAutomationV3.BatchTooLarge.selector,
                candidates.length,
                automation.MAX_BATCH_SIZE()
            )
        );
        automation.performBatch(candidates);
    }

    function _stageToTarget() private {
        (,, uint16 next) = v3Hook.stateById(PoolId.wrap(v3PoolId));
        for (uint256 stage; stage < 16 && next < automation.OBSERVATION_CARDINALITY_TARGET(); ++stage) {
            (bool grew,, uint16 stagedNext) = automation.stageOracle(address(v3Vault));
            assertTrue(grew);
            next = stagedNext;
        }
        assertEq(next, automation.OBSERVATION_CARDINALITY_TARGET());
    }
}
