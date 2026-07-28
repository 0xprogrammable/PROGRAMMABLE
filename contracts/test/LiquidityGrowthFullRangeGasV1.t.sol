// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { LiquidityGrowthFullRangeLaunchV1 } from "../src/LiquidityGrowthFullRangeLaunchV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "../src/LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthFullRangeFixture } from "./utils/LiquidityGrowthFullRangeFixture.sol";

/// @notice Reproducible call-gas ceilings for Full-Range V1's launch and keeper lifecycle.
/// @dev These are Foundry call measurements. They do not include the base transaction cost or a gas-price estimate.
contract LiquidityGrowthFullRangeGasV1Test is LiquidityGrowthFullRangeFixture {
    uint256 private constant LAUNCH_GAS_CEILING = 6_800_000;
    uint256 private constant ORACLE_STAGE_GAS_CEILING = 450_000;
    uint256 private constant ORACLE_ACTIVATION_GAS_CEILING = 5_400_000;
    uint256 private constant ONE_VAULT_STAGE_BATCH_GAS_CEILING = 460_000;
    uint256 private constant ONE_VAULT_BATCH_ACTIVATION_GAS_CEILING = 5_500_000;
    uint256 private constant FOUR_VAULT_STAGE_BATCH_GAS_CEILING = 1_800_000;
    uint256 private constant EIGHT_VAULT_STAGE_BATCH_GAS_CEILING = 3_600_000;
    uint256 private constant PROCESS_AND_COMPOUND_GAS_CEILING = 620_000;
    uint256 private constant PROCESS_DURING_COOLDOWN_GAS_CEILING = 55_000;
    uint256 private constant COMPOUND_PENDING_GAS_CEILING = 135_000;
    uint256 private constant AUTOMATION_FIRST_PROCESS_GAS_CEILING = 700_000;
    uint256 private constant AUTOMATION_LATER_PROCESS_GAS_CEILING = 325_000;
    uint256 private constant AUTOMATION_COMPOUND_PENDING_GAS_CEILING = 220_000;
    uint256 private constant FOUR_VAULT_FIRST_PROCESS_BATCH_GAS_CEILING = 3_000_000;
    uint256 private constant EIGHT_VAULT_FIRST_PROCESS_BATCH_GAS_CEILING = 6_000_000;

    function test_gas_atomicFullRangeLaunch() public {
        LiquidityGrowthFullRangeLaunchV1.LaunchParameters memory parameters =
            _fullRangeParameters(keccak256("full-range-gas-launch"));

        vm.startPrank(creator);
        uint256 gasBefore = gasleft();
        LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result =
            fullRangeLauncher.launch{ value: INITIAL_BUY }(parameters);
        uint256 gasUsed = gasBefore - gasleft();
        vm.stopPrank();

        assertNotEq(result.launchHash, bytes32(0));
        assertEq(fullRangeAutomation.registeredVaultCount(), 1);
        assertLt(gasUsed, LAUNCH_GAS_CEILING);
        emit log_named_uint("Full-Range atomic launch gas", gasUsed);
    }

    function test_gas_singleAndCompleteOracleActivation() public {
        (LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,,) =
            _launchFullRange(keccak256("full-range-gas-oracle"));
        (,, uint16 initialCardinalityNext) = hook.stateById(PoolId.wrap(result.poolId));
        assertEq(initialCardinalityNext, fullRangeAutomation.INITIAL_OBSERVATION_CARDINALITY_NEXT());

        uint256 singleGasBefore = gasleft();
        (bool grew, uint16 previous, uint16 next) = fullRangeAutomation.stageOracle(result.growthVault);
        uint256 singleStageGas = singleGasBefore - gasleft();
        assertTrue(grew);
        assertEq(previous, initialCardinalityNext);
        assertEq(next, previous + fullRangeAutomation.OBSERVATION_CARDINALITY_STEP());

        uint256 remainingGasBefore = gasleft();
        uint256 remainingCalls;
        while (next < fullRangeAutomation.OBSERVATION_CARDINALITY_TARGET()) {
            (grew, previous, next) = fullRangeAutomation.stageOracle(result.growthVault);
            assertTrue(grew);
            assertEq(next - previous, _expectedObservationStep(previous));
            remainingCalls++;
        }
        uint256 remainingGas = remainingGasBefore - gasleft();
        uint256 totalActivationGas = singleStageGas + remainingGas;

        assertEq(remainingCalls + 1, 12);
        assertEq(next, fullRangeAutomation.OBSERVATION_CARDINALITY_TARGET());
        assertLt(singleStageGas, ORACLE_STAGE_GAS_CEILING);
        assertLt(totalActivationGas, ORACLE_ACTIVATION_GAS_CEILING);
        emit log_named_uint("Full-Range first 16-slot oracle stage gas", singleStageGas);
        emit log_named_uint("Full-Range complete 2-to-192 oracle activation gas", totalActivationGas);
        emit log_named_uint("Full-Range post-launch oracle stage calls", remainingCalls + 1);
    }

    function test_gas_fourVaultOracleStageBatch() public {
        address[] memory vaults = _launchVaultBatch(4, "full-range-gas-batch-four");

        uint256 gasBefore = gasleft();
        (uint256 attempted, uint256 succeeded) = fullRangeAutomation.stageOracleBatch(vaults);
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(attempted, 4);
        assertEq(succeeded, 4);
        assertLt(gasUsed, FOUR_VAULT_STAGE_BATCH_GAS_CEILING);
        emit log_named_uint("Full-Range four-vault 16-slot stage batch gas", gasUsed);
    }

    function test_gas_oneVaultOracleStageBatch() public {
        address[] memory vaults = _launchVaultBatch(1, "full-range-gas-batch-one");

        uint256 gasBefore = gasleft();
        (uint256 attempted, uint256 succeeded) = fullRangeAutomation.stageOracleBatch(vaults);
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        assertLt(gasUsed, ONE_VAULT_STAGE_BATCH_GAS_CEILING);
        emit log_named_uint("Full-Range one-vault 16-slot stage batch gas", gasUsed);
    }

    function test_gas_completeOracleActivationThroughOneVaultBatches() public {
        address[] memory vaults = _launchVaultBatch(1, "full-range-gas-batch-one-activation");
        LiquidityGrowthFullRangeVaultV1 vault = LiquidityGrowthFullRangeVaultV1(payable(vaults[0]));
        uint16 target = fullRangeAutomation.OBSERVATION_CARDINALITY_TARGET();
        (,, uint16 next) = hook.stateById(PoolId.wrap(vault.poolId()));

        uint256 gasBefore = gasleft();
        uint256 calls;
        while (next < target) {
            (uint256 attempted, uint256 succeeded) = fullRangeAutomation.stageOracleBatch(vaults);
            assertEq(attempted, 1);
            assertEq(succeeded, 1);
            (,, next) = hook.stateById(PoolId.wrap(vault.poolId()));
            calls++;
        }
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(calls, 12);
        assertEq(next, target);
        assertLt(gasUsed, ONE_VAULT_BATCH_ACTIVATION_GAS_CEILING);
        emit log_named_uint("Full-Range complete 2-to-192 one-vault batch activation gas", gasUsed);
    }

    function test_gas_eightVaultOracleStageBatch() public {
        address[] memory vaults = _launchVaultBatch(8, "full-range-gas-batch-eight");

        uint256 gasBefore = gasleft();
        (uint256 attempted, uint256 succeeded) = fullRangeAutomation.stageOracleBatch(vaults);
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(attempted, 8);
        assertEq(succeeded, 8);
        assertLt(gasUsed, EIGHT_VAULT_STAGE_BATCH_GAS_CEILING);
        emit log_named_uint("Full-Range eight-vault 16-slot stage batch gas", gasUsed);
    }

    function test_gas_firstProcessAndLaterCompoundPending() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) =
            _launchFullRange(keccak256("full-range-gas-compound"));
        _stageFullRangeOracle(address(vault));
        _seedFullRangeCreatorFees(key, 0.16 ether);
        _matureFullRangeOracle(key);

        uint256 gasBefore = gasleft();
        (uint256 received, LiquidityGrowthFullRangeVaultV1.CompoundResult memory first) = vault.process();
        uint256 processAndCompoundGas = gasBefore - gasleft();
        assertGt(received, 0);
        assertGt(first.liquidityAdded, 0);
        assertGt(first.nativeAdded, 0);

        _seedFullRangeCreatorFees(key, 0.16 ether);
        gasBefore = gasleft();
        (received,) = vault.process();
        uint256 processDuringCooldownGas = gasBefore - gasleft();
        assertGt(received, 0);
        assertGt(vault.pendingGrowthNative(), 0);

        _matureFullRangeOracle(key);
        gasBefore = gasleft();
        LiquidityGrowthFullRangeVaultV1.CompoundResult memory later = vault.compoundPending();
        uint256 compoundPendingGas = gasBefore - gasleft();

        assertGt(later.liquidityAdded, 0);
        assertGt(later.nativeAdded, 0);
        assertLt(processAndCompoundGas, PROCESS_AND_COMPOUND_GAS_CEILING);
        assertLt(processDuringCooldownGas, PROCESS_DURING_COOLDOWN_GAS_CEILING);
        assertLt(compoundPendingGas, COMPOUND_PENDING_GAS_CEILING);
        emit log_named_uint("Full-Range process plus first compound gas", processAndCompoundGas);
        emit log_named_uint("Full-Range process during cooldown gas", processDuringCooldownGas);
        emit log_named_uint("Full-Range later compoundPending gas", compoundPendingGas);
    }

    function test_gas_automationKeeperLifecycleCalls() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) =
            _launchFullRange(keccak256("full-range-gas-automation"));
        _stageFullRangeOracle(address(vault));
        address[] memory candidate = new address[](1);
        candidate[0] = address(vault);

        _seedFullRangeCreatorFees(key, 0.16 ether);
        _matureFullRangeOracle(key);
        uint256 liquidityBefore = vault.totalLiquidityAdded();
        uint256 gasBefore = gasleft();
        (uint256 attempted, uint256 succeeded) = fullRangeAutomation.performBatch(candidate);
        uint256 firstProcessGas = gasBefore - gasleft();
        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        assertGt(vault.totalLiquidityAdded(), liquidityBefore);

        _seedFullRangeCreatorFees(key, 0.16 ether);
        _matureFullRangeOracle(key);
        liquidityBefore = vault.totalLiquidityAdded();
        gasBefore = gasleft();
        (attempted, succeeded) = fullRangeAutomation.performBatch(candidate);
        uint256 laterProcessGas = gasBefore - gasleft();
        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        assertGt(vault.totalLiquidityAdded(), liquidityBefore);

        _seedFullRangeCreatorFees(key, 0.16 ether);
        (uint256 received,) = vault.process();
        assertGt(received, 0);
        _matureFullRangeOracle(key);
        liquidityBefore = vault.totalLiquidityAdded();
        gasBefore = gasleft();
        (attempted, succeeded) = fullRangeAutomation.performBatch(candidate);
        uint256 compoundPendingGas = gasBefore - gasleft();
        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        assertGt(vault.totalLiquidityAdded(), liquidityBefore);

        assertLt(firstProcessGas, AUTOMATION_FIRST_PROCESS_GAS_CEILING);
        assertLt(laterProcessGas, AUTOMATION_LATER_PROCESS_GAS_CEILING);
        assertLt(compoundPendingGas, AUTOMATION_COMPOUND_PENDING_GAS_CEILING);
        emit log_named_uint("Full-Range automation first process plus compound gas", firstProcessGas);
        emit log_named_uint("Full-Range automation later process plus compound gas", laterProcessGas);
        emit log_named_uint("Full-Range automation later compoundPending gas", compoundPendingGas);
    }

    function test_gas_fourVaultFirstProcessBatch() public {
        address[] memory vaults = _prepareFirstProcessBatch(4, "full-range-gas-process-four");

        uint256 gasBefore = gasleft();
        (uint256 attempted, uint256 succeeded) = fullRangeAutomation.performBatch(vaults);
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(attempted, 4);
        assertEq(succeeded, 4);
        assertLt(gasUsed, FOUR_VAULT_FIRST_PROCESS_BATCH_GAS_CEILING);
        emit log_named_uint("Full-Range four-vault first process batch gas", gasUsed);
    }

    function test_gas_eightVaultFirstProcessBatch() public {
        address[] memory vaults = _prepareFirstProcessBatch(8, "full-range-gas-process-eight");

        uint256 gasBefore = gasleft();
        (uint256 attempted, uint256 succeeded) = fullRangeAutomation.performBatch(vaults);
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(attempted, 8);
        assertEq(succeeded, 8);
        assertLt(gasUsed, EIGHT_VAULT_FIRST_PROCESS_BATCH_GAS_CEILING);
        emit log_named_uint("Full-Range eight-vault first process batch gas", gasUsed);
    }

    function _launchVaultBatch(uint256 count, string memory label) private returns (address[] memory vaults) {
        vaults = new address[](count);
        for (uint256 index; index < count; index++) {
            (LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,,) =
                _launchFullRange(keccak256(abi.encode(label, index)));
            vaults[index] = result.growthVault;
        }
    }

    function _prepareFirstProcessBatch(uint256 count, string memory label) private returns (address[] memory vaults) {
        vaults = new address[](count);
        for (uint256 index; index < count; index++) {
            (, PoolKey memory key, LiquidityGrowthFullRangeVaultV1 vault) =
                _launchFullRange(keccak256(abi.encode(label, index)));
            _stageFullRangeOracle(address(vault));
            _seedFullRangeCreatorFees(key, 0.16 ether);
            _matureFullRangeOracle(key);
            vaults[index] = address(vault);
        }
    }

    function _expectedObservationStep(uint16 previous) private view returns (uint16) {
        uint16 target = fullRangeAutomation.OBSERVATION_CARDINALITY_TARGET();
        uint16 remaining = target - previous;
        uint16 step = fullRangeAutomation.OBSERVATION_CARDINALITY_STEP();
        return remaining < step ? remaining : step;
    }
}
