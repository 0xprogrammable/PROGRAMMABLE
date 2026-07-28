// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { LiquidityGrowthFullRangeFixture } from "./utils/LiquidityGrowthFullRangeFixture.sol";

/// @notice Runtime-size regression gates for every deployable Full-Range V1 component.
contract LiquidityGrowthFullRangeSizeV1Test is LiquidityGrowthFullRangeFixture {
    uint256 private constant EIP_170_RUNTIME_LIMIT = 24_576;
    uint256 private constant EIP_3860_INITCODE_LIMIT = 49_152;
    uint256 private constant LAUNCHER_INTERNAL_LIMIT = 20_000;
    uint256 private constant VAULT_IMPLEMENTATION_INTERNAL_LIMIT = 23_000;
    uint256 private constant AUTOMATION_INTERNAL_LIMIT = 10_000;
    uint256 private constant FACTORY_INTERNAL_LIMIT = 10_000;
    uint256 private constant POSITION_PLANNER_INTERNAL_LIMIT = 9000;
    uint256 private constant LAUNCHER_INITCODE_INTERNAL_LIMIT = 44_000;
    uint256 private constant VAULT_INITCODE_INTERNAL_LIMIT = 24_000;
    uint256 private constant AUTOMATION_INITCODE_INTERNAL_LIMIT = 10_000;
    uint256 private constant FACTORY_INITCODE_INTERNAL_LIMIT = 35_000;
    uint256 private constant POSITION_PLANNER_INITCODE_INTERNAL_LIMIT = 9000;

    function test_size_fullRangeRuntimeRegressionGates() public view {
        uint256 launcherSize = address(fullRangeLauncher).code.length;
        uint256 vaultImplementationSize = fullRangeVaultFactory.implementation().code.length;
        uint256 automationSize = address(fullRangeAutomation).code.length;
        uint256 factorySize = address(fullRangeVaultFactory).code.length;
        uint256 plannerSize = address(fullRangeLauncher.positionPlanner()).code.length;

        assertLt(launcherSize, EIP_170_RUNTIME_LIMIT);
        assertLt(vaultImplementationSize, EIP_170_RUNTIME_LIMIT);
        assertLt(automationSize, EIP_170_RUNTIME_LIMIT);
        assertLt(factorySize, EIP_170_RUNTIME_LIMIT);
        assertLt(plannerSize, EIP_170_RUNTIME_LIMIT);

        assertLt(launcherSize, LAUNCHER_INTERNAL_LIMIT);
        assertLt(vaultImplementationSize, VAULT_IMPLEMENTATION_INTERNAL_LIMIT);
        assertLt(automationSize, AUTOMATION_INTERNAL_LIMIT);
        assertLt(factorySize, FACTORY_INTERNAL_LIMIT);
        assertLt(plannerSize, POSITION_PLANNER_INTERNAL_LIMIT);
    }

    function test_size_fullRangeInitcodeRegressionGates() public view {
        uint256 launcherSize = _initcode("LiquidityGrowthFullRangeLaunchV1").length;
        uint256 vaultSize = _initcode("LiquidityGrowthFullRangeVaultV1").length;
        uint256 automationSize = _initcode("LiquidityGrowthFullRangeAutomationV1").length;
        uint256 factorySize = _initcode("LiquidityGrowthFullRangeVaultFactoryV1").length;
        uint256 plannerSize = _initcode("LiquidityGrowthFullRangePositionPlannerV1").length;

        assertLt(launcherSize, EIP_3860_INITCODE_LIMIT);
        assertLt(vaultSize, EIP_3860_INITCODE_LIMIT);
        assertLt(automationSize, EIP_3860_INITCODE_LIMIT);
        assertLt(factorySize, EIP_3860_INITCODE_LIMIT);
        assertLt(plannerSize, EIP_3860_INITCODE_LIMIT);

        assertLt(launcherSize, LAUNCHER_INITCODE_INTERNAL_LIMIT);
        assertLt(vaultSize, VAULT_INITCODE_INTERNAL_LIMIT);
        assertLt(automationSize, AUTOMATION_INITCODE_INTERNAL_LIMIT);
        assertLt(factorySize, FACTORY_INITCODE_INTERNAL_LIMIT);
        assertLt(plannerSize, POSITION_PLANNER_INITCODE_INTERNAL_LIMIT);
    }

    function test_size_logFullRangeRuntimeSizes() public {
        emit log_named_uint("Full-Range launcher runtime bytes", address(fullRangeLauncher).code.length);
        emit log_named_uint(
            "Full-Range vault implementation runtime bytes", fullRangeVaultFactory.implementation().code.length
        );
        emit log_named_uint("Full-Range automation runtime bytes", address(fullRangeAutomation).code.length);
        emit log_named_uint("Full-Range vault factory runtime bytes", address(fullRangeVaultFactory).code.length);
        emit log_named_uint(
            "Full-Range position planner runtime bytes", address(fullRangeLauncher.positionPlanner()).code.length
        );
        emit log_named_uint("Full-Range launcher initcode bytes", _initcode("LiquidityGrowthFullRangeLaunchV1").length);
        emit log_named_uint("Full-Range vault initcode bytes", _initcode("LiquidityGrowthFullRangeVaultV1").length);
        emit log_named_uint(
            "Full-Range automation initcode bytes", _initcode("LiquidityGrowthFullRangeAutomationV1").length
        );
        emit log_named_uint(
            "Full-Range vault factory initcode bytes", _initcode("LiquidityGrowthFullRangeVaultFactoryV1").length
        );
        emit log_named_uint(
            "Full-Range position planner initcode bytes", _initcode("LiquidityGrowthFullRangePositionPlannerV1").length
        );
    }

    function _initcode(string memory contractName) private view returns (bytes memory) {
        return vm.getCode(string.concat("src/", contractName, ".sol:", contractName));
    }
}
