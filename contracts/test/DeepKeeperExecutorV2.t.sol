// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

import { DeepKeeperExecutorV2 } from "../src/DeepKeeperExecutorV2.sol";
import { LiquidityGrowthFullRangeAutomationV3 } from "../src/LiquidityGrowthFullRangeAutomationV3.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultFactoryV3 } from "../src/LiquidityGrowthFullRangeVaultFactoryV3.sol";
import { LiquidityGrowthFullRangeV3Fixture } from "./utils/LiquidityGrowthFullRangeV3Fixture.sol";

contract DeepV3ExecutorUnknownAutomation { }

contract DeepV3ExecutorBinding {
    LiquidityGrowthFullRangeAutomationV3 public automation;
    address public immutable growthVaultFactory;

    constructor(address growthVaultFactory_) {
        growthVaultFactory = growthVaultFactory_;
    }

    function bind(LiquidityGrowthFullRangeAutomationV3 automation_) external {
        automation = automation_;
    }
}

contract DeepV3ExecutorMalformedAutomation {
    address public immutable launcher;
    LiquidityGrowthFullRangeVaultFactoryV3 public immutable vaultFactory;
    uint8 public mode;

    constructor(address launcher_, LiquidityGrowthFullRangeVaultFactoryV3 vaultFactory_) {
        launcher = launcher_;
        vaultFactory = vaultFactory_;
    }

    function setMode(uint8 mode_) external {
        mode = mode_;
    }

    function assessVault(address) external view returns (LiquidityGrowthFullRangeAutomationV3.Action action) {
        uint8 currentMode = mode;
        if (currentMode == 1) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (currentMode == 3) {
            assembly ("memory-safe") {
                mstore(0, 99)
                return(0, 0x20)
            }
        }
        return LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle;
    }

    function performVault(address)
        external
        view
        returns (bool succeeded, LiquidityGrowthFullRangeAutomationV3.Action action)
    {
        if (mode == 2) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(0, 0x20)
            }
        }
        return (true, LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle);
    }
}

contract DeepKeeperExecutorV2Test is LiquidityGrowthFullRangeV3Fixture {
    LiquidityGrowthFullRangeAutomationV3 private keeperAutomation;
    DeepKeeperExecutorV2 private executor;

    function setUp() public override {
        super.setUp();
        keeperAutomation = new LiquidityGrowthFullRangeAutomationV3(v3VaultFactory, address(this));
        keeperAutomation.registerAndStageOracle(address(v3Vault));
        executor = new DeepKeeperExecutorV2(keeperAutomation);
    }

    function automation() external view returns (LiquidityGrowthFullRangeAutomationV3) {
        return keeperAutomation;
    }

    function growthVaultFactory() external view returns (address) {
        return address(v3VaultFactory);
    }

    function test_executorReassessesAndExecutesOneAtomicCompoundBelowReviewedCeiling() public {
        _stageToTarget();
        vm.warp(block.timestamp + Policy.TWAP_WINDOW);
        vm.roll(block.number + 150);

        DeepKeeperExecutorV2.Candidate[] memory candidates =
            _singleCandidate(address(v3Vault), LiquidityGrowthFullRangeAutomationV3.Action.Compound);
        uint256 nonceBefore = v3Vault.compoundNonce();
        uint256 gasBefore = gasleft();
        (, uint256 attempted, uint256 succeeded) = executor.execute(candidates);
        uint256 measuredGas = gasBefore - gasleft();

        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        assertEq(v3Vault.compoundNonce(), nonceBefore + 1);
        uint256 reviewedCeiling = _eip150(executor.ASSESSMENT_GAS_STIPEND()) + _eip150(executor.COMPOUND_GAS_STIPEND())
            + executor.RESULT_GAS_RESERVE() + executor.FINAL_GAS_RESERVE();
        assertLe(measuredGas * 100, reviewedCeiling * 80);
        emit log_named_uint("Deep V3 executor measured compound gas", measuredGas);
        emit log_named_uint("Deep V3 executor reviewed per-vault ceiling", reviewedCeiling);
    }

    function test_executorExecutesOracleGrowthAndSkipsActionDrift() public {
        DeepKeeperExecutorV2.Candidate[] memory candidates =
            _singleCandidate(address(v3Vault), LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle);
        (, uint256 attempted, uint256 succeeded) = executor.execute(candidates);
        assertEq(attempted, 1);
        assertEq(succeeded, 1);

        candidates[0].expectedAction = LiquidityGrowthFullRangeAutomationV3.Action.Compound;
        (, attempted, succeeded) = executor.execute(candidates);
        assertEq(attempted, 0);
        assertEq(succeeded, 0);
    }

    function test_executorRejectsUnknownAutomationAndMalformedReturnShapes() public {
        DeepV3ExecutorUnknownAutomation unknown = new DeepV3ExecutorUnknownAutomation();
        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV2.InvalidAutomation.selector, address(unknown)));
        new DeepKeeperExecutorV2(LiquidityGrowthFullRangeAutomationV3(address(unknown)));

        DeepV3ExecutorBinding binding = new DeepV3ExecutorBinding(address(v3VaultFactory));
        DeepV3ExecutorMalformedAutomation malformed =
            new DeepV3ExecutorMalformedAutomation(address(binding), v3VaultFactory);
        binding.bind(LiquidityGrowthFullRangeAutomationV3(address(malformed)));
        DeepKeeperExecutorV2 malformedExecutor =
            new DeepKeeperExecutorV2(LiquidityGrowthFullRangeAutomationV3(address(malformed)));
        DeepKeeperExecutorV2.Candidate[] memory candidates =
            _singleCandidate(address(v3Vault), LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle);

        malformed.setMode(1);
        (, uint256 attempted, uint256 succeeded) = malformedExecutor.execute(candidates);
        assertEq(attempted, 0);
        assertEq(succeeded, 0);

        malformed.setMode(2);
        (, attempted, succeeded) = malformedExecutor.execute(candidates);
        assertEq(attempted, 1);
        assertEq(succeeded, 0);

        malformed.setMode(3);
        (, attempted, succeeded) = malformedExecutor.execute(candidates);
        assertEq(attempted, 0);
        assertEq(succeeded, 0);
    }

    function test_executorRejectsEmptyOversizedDuplicateZeroAndNoneCandidates() public {
        DeepKeeperExecutorV2.Candidate[] memory empty = new DeepKeeperExecutorV2.Candidate[](0);
        vm.expectRevert(DeepKeeperExecutorV2.EmptyBatch.selector);
        executor.execute(empty);

        DeepKeeperExecutorV2.Candidate[] memory oversized =
            new DeepKeeperExecutorV2.Candidate[](executor.MAX_BATCH_SIZE() + 1);
        for (uint256 index; index < oversized.length; ++index) {
            oversized[index] = DeepKeeperExecutorV2.Candidate({
                vault: address(uint160(index + 1)),
                expectedAction: LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle
            });
        }
        vm.expectRevert(
            abi.encodeWithSelector(
                DeepKeeperExecutorV2.BatchTooLarge.selector, oversized.length, executor.MAX_BATCH_SIZE()
            )
        );
        executor.execute(oversized);

        DeepKeeperExecutorV2.Candidate[] memory duplicate = new DeepKeeperExecutorV2.Candidate[](2);
        duplicate[0] = DeepKeeperExecutorV2.Candidate({
            vault: address(v3Vault), expectedAction: LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle
        });
        duplicate[1] = duplicate[0];
        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV2.DuplicateVault.selector, address(v3Vault), 0, 1));
        executor.execute(duplicate);

        DeepKeeperExecutorV2.Candidate[] memory invalid =
            _singleCandidate(address(0), LiquidityGrowthFullRangeAutomationV3.Action.GrowOracle);
        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV2.ZeroVault.selector, 0));
        executor.execute(invalid);

        invalid[0] = DeepKeeperExecutorV2.Candidate({
            vault: address(v3Vault), expectedAction: LiquidityGrowthFullRangeAutomationV3.Action.None
        });
        vm.expectRevert(abi.encodeWithSelector(DeepKeeperExecutorV2.InvalidExpectedAction.selector, 0));
        executor.execute(invalid);
    }

    function _singleCandidate(address vault, LiquidityGrowthFullRangeAutomationV3.Action action)
        private
        pure
        returns (DeepKeeperExecutorV2.Candidate[] memory candidates)
    {
        candidates = new DeepKeeperExecutorV2.Candidate[](1);
        candidates[0] = DeepKeeperExecutorV2.Candidate({ vault: vault, expectedAction: action });
    }

    function _stageToTarget() private {
        (,, uint16 next) = v3Hook.stateById(PoolId.wrap(v3PoolId));
        for (uint256 stage; stage < 16 && next < keeperAutomation.OBSERVATION_CARDINALITY_TARGET(); ++stage) {
            (bool grew,, uint16 stagedNext) = keeperAutomation.stageOracle(address(v3Vault));
            assertTrue(grew);
            next = stagedNext;
        }
        assertEq(next, keeperAutomation.OBSERVATION_CARDINALITY_TARGET());
    }

    function _eip150(uint256 stipend) private pure returns (uint256) {
        return stipend + (stipend + 62) / 63;
    }
}
