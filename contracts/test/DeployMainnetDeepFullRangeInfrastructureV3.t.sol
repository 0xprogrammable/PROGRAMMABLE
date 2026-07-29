// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { DeployMainnetDeepFullRangeInfrastructureV3 } from "../script/DeployMainnetDeepFullRangeInfrastructureV3.s.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangeLaunchV3 } from "../src/LiquidityGrowthFullRangeLaunchV3.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../src/LiquidityGrowthFullRangeVaultV3.sol";
import { ILiquidityGrowthFullRangeVaultFactoryV3 } from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

contract DeployMainnetDeepFullRangeInfrastructureV3Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_635_400;
    address internal constant DEPLOYER = 0xDeef000000000000000000000000000000000003;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;

    DeployMainnetDeepFullRangeInfrastructureV3 internal deployment;
    bytes32 internal hookSalt;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);
        deployment = new DeployMainnetDeepFullRangeInfrastructureV3();
        hookSalt = _mineHookSalt(DEPLOYER, 0);
    }

    function test_v3DependencyAndSourcePreflightPassOnPinnedMainnetSnapshot() public view {
        deployment.validateOfficialDependencies();
        assertTrue(deployment.deploymentSourceCommitment() != bytes32(0));
    }

    function test_v3PlanDeploysTheExactSixTransactionGraph() public {
        DeployMainnetDeepFullRangeInfrastructureV3.DeploymentPlan memory plan =
            deployment.deploymentPlan(DEPLOYER, 0, hookSalt);
        DeployMainnetDeepFullRangeInfrastructureV3.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY, hookSalt);

        assertEq(address(result.zapPlanner), plan.zapPlanner);
        assertEq(address(result.growthVaultFactory), plan.growthVaultFactory);
        assertEq(result.growthVaultFactory.implementation(), plan.growthVaultImplementation);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.feeHook), plan.feeHook);
        assertEq(address(result.launcher), plan.launcher);
        assertEq(address(result.positionPlanner), plan.positionPlanner);
        assertEq(address(result.automation), plan.automation);
        assertEq(address(result.keeperExecutor), plan.keeperExecutor);
        assertEq(result.hookSalt, hookSalt);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment());
        assertEq(vm.getNonce(DEPLOYER), 6);

        assertEq(address(result.growthVaultFactory.planner()), plan.zapPlanner);
        assertEq(address(result.feeHook.growthVaultFactory()), plan.growthVaultFactory);
        assertEq(address(result.launcher.feeHook()), plan.feeHook);
        assertEq(address(result.launcher.growthVaultFactory()), plan.growthVaultFactory);
        assertEq(address(result.launcher.positionPlanner()), plan.positionPlanner);
        assertEq(address(result.launcher.automation()), plan.automation);
        assertEq(address(result.automation.vaultFactory()), plan.growthVaultFactory);
        assertEq(result.automation.launcher(), plan.launcher);
        assertEq(address(result.keeperExecutor.automation()), plan.automation);
    }

    function test_v3MainnetForkRehearsalLaunchesOneCompleteDeepToken() public {
        DeployMainnetDeepFullRangeInfrastructureV3.DeploymentResult memory infrastructure =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY, hookSalt);
        LiquidityGrowthFullRangeLaunchV3 launcher = infrastructure.launcher;
        address creator = makeAddr("deepV3ReleaseCreator");
        vm.deal(creator, 1 ether);

        LiquidityGrowthFullRangeLaunchV3.LaunchParameters memory parameters =
            LiquidityGrowthFullRangeLaunchV3.LaunchParameters({
                name: "Deep Release",
                symbol: "DEEP",
                metadata: UERC20Metadata({
                    description: "Deep exact Mainnet release rehearsal",
                    website: "https://programmable.family",
                    image: "ipfs://programmable-deep-release",
                    extraData: bytes('{"model":"deep"}')
                }),
                creatorSalt: keccak256("deep-v3-release-fork"),
                minimumInitialTokenOut: 1,
                initialBuySqrtPriceLimitX96: launcher.MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96(),
                deadline: block.timestamp + 30 minutes
            });

        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        uint256 initialBuy = launcher.MIN_INITIAL_BUY_WEI();
        vm.prank(creator);
        LiquidityGrowthFullRangeLaunchV3.LaunchResult memory result = launcher.launch{ value: initialBuy }(parameters);
        LiquidityGrowthFullRangeVaultV3 vault = LiquidityGrowthFullRangeVaultV3(payable(result.growthVault));

        assertEq(result.token, predictedToken);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(IERC20(result.token).balanceOf(address(vault)), result.initialLockedTokenDust);
        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(vault.poolId(), result.poolId);
        assertEq(vault.token(), result.token);
        assertEq(address(vault.feeHook()), address(infrastructure.feeHook));
        assertEq(address(vault.planner()), address(infrastructure.zapPlanner));
        assertEq(vault.FACTORY(), address(infrastructure.growthVaultFactory));
        assertEq(vault.configurationHash(), result.vaultConfigurationHash);
        assertEq(vault.initialTokenDust(), result.initialLockedTokenDust);
        assertEq(vault.accountedTokenDust(), result.initialLockedTokenDust);
        assertTrue(infrastructure.automation.isRegisteredVault(address(vault)));
        assertTrue(infrastructure.growthVaultFactory.isFactoryVault(address(vault)));
        assertTrue(infrastructure.hookFactory.isFactoryHook(address(infrastructure.feeHook)));

        (uint256 expectedGrowth, uint256 expectedProgrammable) =
            infrastructure.feeHook.quoteGrossFees(result.initialBuyNativeAmount);
        (address configuredVault, address registrar, uint8 lifecycle, uint256 growthFees) =
            infrastructure.feeHook.poolFeeConfig(result.poolId);
        assertEq(configuredVault, address(vault));
        assertEq(registrar, address(launcher));
        assertEq(lifecycle, infrastructure.feeHook.LIFECYCLE_FINALIZED());
        assertEq(growthFees, expectedGrowth);
        assertEq(infrastructure.feeHook.launcherFeesAccrued(), expectedProgrammable);
        assertEq(address(launcher).balance, 0);
    }

    function test_v3RejectsStaleNonceWrongTreasuryAndZeroSalt() public {
        bytes32 staleNonceSalt = _mineHookSalt(DEPLOYER, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV3.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1, TREASURY, staleNonceSalt);

        address wrongTreasury = makeAddr("wrongDeepV3Treasury");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV3.UnexpectedTreasury.selector, wrongTreasury, TREASURY
            )
        );
        deployment.deployReviewed(DEPLOYER, 0, wrongTreasury, hookSalt);

        vm.expectRevert(
            abi.encodeWithSelector(DeployMainnetDeepFullRangeInfrastructureV3.InvalidHookSalt.selector, bytes32(0))
        );
        deployment.deployReviewed(DEPLOYER, 0, TREASURY, bytes32(0));
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
}
