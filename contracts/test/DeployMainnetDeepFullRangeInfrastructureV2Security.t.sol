// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Test } from "forge-std/Test.sol";

import { DeployMainnetDeepFullRangeInfrastructureV1 } from "../script/DeployMainnetDeepFullRangeInfrastructureV1.s.sol";
import { DeployMainnetDeepFullRangeInfrastructureV2 } from "../script/DeployMainnetDeepFullRangeInfrastructureV2.s.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "../src/LiquidityGrowthFullRangeVaultV2.sol";
import { LiquidityGrowthRangeSourceFactoryV1 } from "../src/LiquidityGrowthRangeSourceFactoryV1.sol";

/// @notice Independent deployment-boundary tests for the Deep V2 Mainnet script.
/// @dev The product script is intentionally not modified by this suite.
contract DeployMainnetDeepFullRangeInfrastructureV2SecurityTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_632_900;
    address internal constant DEPLOYER = 0xdeEF000000000000000000000000000000000022;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    DeployMainnetDeepFullRangeInfrastructureV2 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);
        deployment = new DeployMainnetDeepFullRangeInfrastructureV2();
    }

    function test_v2OfficialRuntimePinsMatchThePinnedMainnetSnapshot() public view {
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

    function test_v2PlanIsReadOnlyUniqueAndAddressPredictionIsSelfConsistent() public {
        uint64 startingNonce = 17;
        uint64 nonceBefore = vm.getNonce(DEPLOYER);
        DeployMainnetDeepFullRangeInfrastructureV2.DeploymentPlan memory plan =
            deployment.deploymentPlan(DEPLOYER, startingNonce);

        assertEq(vm.getNonce(DEPLOYER), nonceBefore);
        assertEq(plan.feeSplitVaultFactory, deployment.FEE_SPLIT_VAULT_FACTORY());
        assertEq(plan.hookFactory, deployment.HOOK_FACTORY());
        assertEq(plan.feeHook, deployment.FEE_HOOK());
        assertEq(plan.rangeSourceFactory, deployment.RANGE_SOURCE_FACTORY());
        assertEq(plan.growthVaultFactory, vm.computeCreateAddress(DEPLOYER, startingNonce));
        assertEq(plan.growthVaultImplementation, vm.computeCreateAddress(plan.growthVaultFactory, 1));
        assertEq(plan.launcher, vm.computeCreateAddress(DEPLOYER, uint256(startingNonce) + 1));
        assertEq(plan.automation, vm.computeCreateAddress(plan.launcher, 1));
        assertEq(plan.positionPlanner, vm.computeCreateAddress(plan.launcher, 2));
        assertEq(uint160(plan.feeHook) & Hooks.ALL_HOOK_MASK, deployment.REQUIRED_HOOK_FLAGS());

        address[] memory targets = _targets(plan);
        for (uint256 left; left < targets.length; left++) {
            assertTrue(targets[left] != address(0));
            for (uint256 right = left + 1; right < targets.length; right++) {
                assertTrue(targets[left] != targets[right]);
            }
        }
    }

    function test_v2EveryReviewedTargetMustBeVacantBeforeAnyBroadcastedCreation() public {
        DeployMainnetDeepFullRangeInfrastructureV2.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        address[] memory targets = _targets(plan);

        for (uint256 index; index < targets.length; index++) {
            uint256 snapshot = vm.snapshotState();
            vm.etch(targets[index], hex"fe");
            assertGt(targets[index].code.length, 0);
            vm.expectRevert(
                abi.encodeWithSelector(
                    DeployMainnetDeepFullRangeInfrastructureV2.DeploymentAddressOccupied.selector, targets[index]
                )
            );
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);
            assertEq(vm.getNonce(DEPLOYER), 0);
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function test_v2NonzeroNonceDeploymentMatchesTheReviewedOrderAndConstructorGraph() public {
        uint64 startingNonce = 19;
        vm.setNonce(DEPLOYER, startingNonce);
        DeployMainnetDeepFullRangeInfrastructureV2.DeploymentPlan memory plan =
            deployment.deploymentPlan(DEPLOYER, startingNonce);
        DeployMainnetDeepFullRangeInfrastructureV2.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, startingNonce, TREASURY);

        assertEq(vm.getNonce(DEPLOYER), startingNonce + 2);
        assertEq(address(result.feeSplitVaultFactory), plan.feeSplitVaultFactory);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.feeHook), plan.feeHook);
        assertEq(address(result.rangeSourceFactory), plan.rangeSourceFactory);
        assertEq(address(result.growthVaultFactory), plan.growthVaultFactory);
        assertEq(result.growthVaultFactory.implementation(), plan.growthVaultImplementation);
        assertEq(address(result.launcher), plan.launcher);
        assertEq(address(result.automation), plan.automation);
        assertEq(address(result.positionPlanner), plan.positionPlanner);

        assertEq(address(result.feeHook.poolManager()), deployment.POOL_MANAGER());
        assertEq(result.feeHook.launcherFeeRecipient(), TREASURY);
        assertEq(address(result.feeHook.feeSplitVaultFactory()), address(result.feeSplitVaultFactory));
        assertEq(address(result.growthVaultFactory.hookFactory()), address(result.hookFactory));
        assertEq(address(result.growthVaultFactory.feeSplitVaultFactory()), address(result.feeSplitVaultFactory));
        assertEq(address(result.growthVaultFactory.positionManager()), deployment.POSITION_MANAGER());
        assertEq(address(result.growthVaultFactory.poolManager()), deployment.POOL_MANAGER());
        assertEq(address(result.growthVaultFactory.positionForwarderFactory()), deployment.LOCKED_POSITION_FACTORY());
        assertEq(address(result.growthVaultFactory.rangeSourceFactory()), address(result.rangeSourceFactory));
        assertEq(
            LiquidityGrowthFullRangeVaultV2(payable(plan.growthVaultImplementation)).FACTORY(), plan.growthVaultFactory
        );

        assertEq(address(result.launcher.poolManager()), deployment.POOL_MANAGER());
        assertEq(address(result.launcher.positionManager()), deployment.POSITION_MANAGER());
        assertEq(address(result.launcher.tokenFactory()), deployment.UERC20_FACTORY());
        assertEq(address(result.launcher.feeHook()), plan.feeHook);
        assertEq(address(result.launcher.feeSplitVaultFactory()), plan.feeSplitVaultFactory);
        assertEq(address(result.launcher.rangeSourceFactory()), plan.rangeSourceFactory);
        assertEq(address(result.launcher.growthVaultFactory()), plan.growthVaultFactory);
        assertEq(address(result.launcher.positionForwarderFactory()), deployment.LOCKED_POSITION_FACTORY());
        assertEq(address(result.launcher.automation()), plan.automation);
        assertEq(address(result.launcher.positionPlanner()), plan.positionPlanner);
        assertEq(address(result.automation.vaultFactory()), plan.growthVaultFactory);
        assertEq(result.automation.launcher(), plan.launcher);

        assertEq(plan.feeSplitVaultFactory.codehash, keccak256(type(FeeSplitVaultFactoryV1).runtimeCode));
        assertEq(plan.hookFactory.codehash, keccak256(type(LiquidityGrowthFeeOracleHookFactoryV1).runtimeCode));
        assertEq(plan.rangeSourceFactory.codehash, keccak256(type(LiquidityGrowthRangeSourceFactoryV1).runtimeCode));
    }

    function test_v2SourceCommitmentIsDomainSeparatedFromV1AndStableAcrossPlans() public {
        DeployMainnetDeepFullRangeInfrastructureV1 v1 = new DeployMainnetDeepFullRangeInfrastructureV1();
        bytes32 v2Commitment = deployment.deploymentSourceCommitment();
        assertTrue(v2Commitment != bytes32(0));
        assertTrue(v2Commitment != v1.deploymentSourceCommitment());
        assertEq(deployment.deploymentPlan(DEPLOYER, 0).sourceCommitment, v2Commitment);
        assertEq(deployment.deploymentPlan(DEPLOYER, 50).sourceCommitment, v2Commitment);
    }

    function test_v2RejectsWrongChainZeroBroadcasterAndOfficialRuntimeDrift() public {
        vm.expectRevert(
            abi.encodeWithSelector(DeployMainnetDeepFullRangeInfrastructureV2.InvalidBroadcaster.selector, address(0))
        );
        deployment.deploymentPlan(address(0), 0);

        vm.chainId(11_155_111);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV2.UnexpectedChain.selector, uint256(11_155_111), uint256(1)
            )
        );
        deployment.validateOfficialDependencies();
        vm.chainId(1);

        address poolManager = deployment.POOL_MANAGER();
        bytes32 expectedCodeHash = deployment.POOL_MANAGER_CODEHASH();
        vm.etch(poolManager, hex"fe");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV2.UnexpectedCodeHash.selector,
                poolManager,
                keccak256(hex"fe"),
                expectedCodeHash
            )
        );
        deployment.validateOfficialDependencies();
    }

    function _targets(DeployMainnetDeepFullRangeInfrastructureV2.DeploymentPlan memory plan)
        private
        pure
        returns (address[] memory targets)
    {
        targets = new address[](5);
        targets[0] = plan.growthVaultFactory;
        targets[1] = plan.growthVaultImplementation;
        targets[2] = plan.launcher;
        targets[3] = plan.automation;
        targets[4] = plan.positionPlanner;
    }
}
