// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { DeployMainnetDeepFullRangeInfrastructureV3 } from "../script/DeployMainnetDeepFullRangeInfrastructureV3.s.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../src/LiquidityGrowthFullRangeVaultV3.sol";
import { ILiquidityGrowthFullRangeVaultFactoryV3 } from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

/// @notice Independent fail-closed boundary tests for the Deep deployment script.
contract DeployMainnetDeepFullRangeInfrastructureV3SecurityTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_635_400;
    address internal constant DEPLOYER = 0xDEEF000000000000000000000000000000000033;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    DeployMainnetDeepFullRangeInfrastructureV3 internal deployment;
    bytes32 internal hookSalt;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);
        deployment = new DeployMainnetDeepFullRangeInfrastructureV3();
        hookSalt = _mineHookSalt(DEPLOYER, 0);
    }

    function test_v3OfficialRuntimePinsMatchThePinnedMainnetSnapshot() public view {
        assertEq(block.chainid, 1);
        assertEq(block.number, SNAPSHOT_BLOCK);
        assertEq(deployment.POOL_MANAGER().codehash, deployment.POOL_MANAGER_CODEHASH());
        assertEq(deployment.POSITION_MANAGER().codehash, deployment.POSITION_MANAGER_CODEHASH());
        assertEq(deployment.STATE_VIEW().codehash, deployment.STATE_VIEW_CODEHASH());
        assertEq(deployment.V4_QUOTER().codehash, deployment.V4_QUOTER_CODEHASH());
        assertEq(deployment.UERC20_FACTORY().codehash, deployment.UERC20_FACTORY_CODEHASH());
        assertEq(deployment.PERMIT2().codehash, deployment.PERMIT2_CODEHASH());
        assertEq(deployment.UNIVERSAL_ROUTER().codehash, deployment.UNIVERSAL_ROUTER_CODEHASH());
        assertEq(deployment.LOCKED_POSITION_FACTORY().codehash, deployment.LOCKED_POSITION_FACTORY_CODEHASH());
        assertEq(
            address(IPositionManager(deployment.POSITION_MANAGER()).poolManager()),
            address(IPoolManager(deployment.POOL_MANAGER()))
        );
    }

    function test_v3PlanIsReadOnlyUniqueAndUsesTheReviewedNonceOrder() public view {
        uint64 startingNonce = 17;
        bytes32 salt = _mineHookSalt(DEPLOYER, startingNonce);
        uint64 nonceBefore = vm.getNonce(DEPLOYER);
        DeployMainnetDeepFullRangeInfrastructureV3.DeploymentPlan memory plan =
            deployment.deploymentPlan(DEPLOYER, startingNonce, salt);

        assertEq(vm.getNonce(DEPLOYER), nonceBefore);
        assertEq(plan.zapPlanner, vm.computeCreateAddress(DEPLOYER, startingNonce));
        assertEq(plan.growthVaultFactory, vm.computeCreateAddress(DEPLOYER, uint256(startingNonce) + 1));
        assertEq(plan.growthVaultImplementation, vm.computeCreateAddress(plan.growthVaultFactory, 1));
        assertEq(plan.hookFactory, vm.computeCreateAddress(DEPLOYER, uint256(startingNonce) + 2));
        assertEq(plan.launcher, vm.computeCreateAddress(DEPLOYER, uint256(startingNonce) + 4));
        assertEq(plan.positionPlanner, vm.computeCreateAddress(plan.launcher, 1));
        assertEq(plan.automation, vm.computeCreateAddress(plan.launcher, 2));
        assertEq(plan.keeperExecutor, vm.computeCreateAddress(DEPLOYER, uint256(startingNonce) + 5));
        assertEq(uint160(plan.feeHook) & Hooks.ALL_HOOK_MASK, deployment.REQUIRED_HOOK_FLAGS());
        assertEq(deployment.REQUIRED_HOOK_FLAGS(), uint160(0x3aec));

        address[] memory targets = _targets(plan);
        for (uint256 left; left < targets.length; ++left) {
            assertTrue(targets[left] != address(0));
            for (uint256 right = left + 1; right < targets.length; ++right) {
                assertTrue(targets[left] != targets[right]);
            }
        }
    }

    function test_v3EveryReviewedTargetMustBeVacantBeforeAnyBroadcastedTransaction() public {
        DeployMainnetDeepFullRangeInfrastructureV3.DeploymentPlan memory plan =
            deployment.deploymentPlan(DEPLOYER, 0, hookSalt);
        address[] memory targets = _targets(plan);

        for (uint256 index; index < targets.length; ++index) {
            uint256 snapshot = vm.snapshotState();
            vm.etch(targets[index], hex"fe");
            vm.expectRevert(
                abi.encodeWithSelector(
                    DeployMainnetDeepFullRangeInfrastructureV3.DeploymentAddressOccupied.selector, targets[index]
                )
            );
            deployment.deployReviewed(DEPLOYER, 0, TREASURY, hookSalt);
            assertEq(vm.getNonce(DEPLOYER), 0);
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function test_v3NonzeroNonceDeploymentMatchesTheReviewedGraph() public {
        uint64 startingNonce = 19;
        vm.setNonce(DEPLOYER, startingNonce);
        bytes32 salt = _mineHookSalt(DEPLOYER, startingNonce);
        DeployMainnetDeepFullRangeInfrastructureV3.DeploymentPlan memory plan =
            deployment.deploymentPlan(DEPLOYER, startingNonce, salt);
        DeployMainnetDeepFullRangeInfrastructureV3.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, startingNonce, TREASURY, salt);

        assertEq(vm.getNonce(DEPLOYER), startingNonce + 6);
        assertEq(address(result.zapPlanner), plan.zapPlanner);
        assertEq(address(result.growthVaultFactory), plan.growthVaultFactory);
        assertEq(result.growthVaultFactory.implementation(), plan.growthVaultImplementation);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.feeHook), plan.feeHook);
        assertEq(address(result.launcher), plan.launcher);
        assertEq(address(result.positionPlanner), plan.positionPlanner);
        assertEq(address(result.automation), plan.automation);
        assertEq(address(result.keeperExecutor), plan.keeperExecutor);
        assertEq(
            LiquidityGrowthFullRangeVaultV3(payable(plan.growthVaultImplementation)).FACTORY(), plan.growthVaultFactory
        );
    }

    function test_v3SourceCommitmentIsStableAndWrongHookSaltFailsBeforeBroadcast() public {
        bytes32 commitment = deployment.deploymentSourceCommitment();
        assertTrue(commitment != bytes32(0));
        assertEq(deployment.deploymentPlan(DEPLOYER, 0, hookSalt).sourceCommitment, commitment);
        bytes32 laterSalt = _mineHookSalt(DEPLOYER, 50);
        assertEq(deployment.deploymentPlan(DEPLOYER, 50, laterSalt).sourceCommitment, commitment);

        bytes32 wrongSalt = bytes32(uint256(1));
        DeployMainnetDeepFullRangeInfrastructureV3.DeploymentPlan memory wrongPlan =
            deployment.deploymentPlan(DEPLOYER, 0, wrongSalt);
        uint160 actualFlags = uint160(wrongPlan.feeHook) & Hooks.ALL_HOOK_MASK;
        assertTrue(actualFlags != deployment.REQUIRED_HOOK_FLAGS());
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV3.UnexpectedHookFlags.selector,
                actualFlags,
                deployment.REQUIRED_HOOK_FLAGS()
            )
        );
        deployment.deployReviewed(DEPLOYER, 0, TREASURY, wrongSalt);
        assertEq(vm.getNonce(DEPLOYER), 0);
    }

    function test_v3RejectsWrongChainRuntimeDriftAndNonceOverflow() public {
        vm.chainId(11_155_111);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV3.UnexpectedChain.selector, uint256(11_155_111), uint256(1)
            )
        );
        deployment.validateOfficialDependencies();
        vm.chainId(1);

        address poolManager = deployment.POOL_MANAGER();
        bytes32 expectedCodeHash = deployment.POOL_MANAGER_CODEHASH();
        vm.etch(poolManager, hex"fe");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV3.UnexpectedCodeHash.selector,
                poolManager,
                keccak256(hex"fe"),
                expectedCodeHash
            )
        );
        deployment.validateOfficialDependencies();

        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV3.UnexpectedValue.selector,
                keccak256("startingNonce"),
                uint256(type(uint64).max),
                uint256(type(uint64).max - 6)
            )
        );
        deployment.deploymentPlan(DEPLOYER, type(uint64).max, hookSalt);
    }

    function _mineHookSalt(address broadcaster, uint64 startingNonce) private view returns (bytes32 salt) {
        address vaultFactory = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1);
        address hookFactory = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 2);
        bytes memory constructorArgs = abi.encode(
            deployment.POOL_MANAGER(),
            TREASURY,
            ILiquidityGrowthFullRangeVaultFactoryV3(vaultFactory),
            deployment.POSITION_MANAGER(),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
        (, salt) = HookMiner.find(
            hookFactory,
            deployment.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV2).creationCode,
            constructorArgs
        );
        require(salt != bytes32(0), "zero hook salt");
    }

    function _targets(DeployMainnetDeepFullRangeInfrastructureV3.DeploymentPlan memory plan)
        private
        pure
        returns (address[] memory targets)
    {
        targets = new address[](9);
        targets[0] = plan.zapPlanner;
        targets[1] = plan.growthVaultFactory;
        targets[2] = plan.growthVaultImplementation;
        targets[3] = plan.hookFactory;
        targets[4] = plan.feeHook;
        targets[5] = plan.launcher;
        targets[6] = plan.positionPlanner;
        targets[7] = plan.automation;
        targets[8] = plan.keeperExecutor;
    }
}
