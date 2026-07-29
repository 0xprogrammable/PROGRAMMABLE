// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { Test } from "forge-std/Test.sol";

import { DeployMainnetDeepFullRangeInfrastructureV2 } from "../script/DeployMainnetDeepFullRangeInfrastructureV2.s.sol";
import { LiquidityGrowthFullRangeLaunchV2 } from "../src/LiquidityGrowthFullRangeLaunchV2.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "../src/LiquidityGrowthFullRangeVaultV2.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";

contract DeployMainnetDeepFullRangeInfrastructureV2Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_632_900;
    address internal constant DEPLOYER = 0xDeef000000000000000000000000000000000002;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant FEE_SPLIT_VAULT_FACTORY = 0xF15D4528Db481732Cdb94FC2558d04ce4D85Cb54;
    address internal constant HOOK_FACTORY = 0xb003a14Ef04D5022A8CfB4158b49f77e2e73b5E9;
    address internal constant FEE_HOOK = 0x48dC3009eC1d3298BBA31f718A9A29d02fC9B0cC;
    address internal constant RANGE_SOURCE_FACTORY = 0xb2Ec2573bB6968b9fA85f1A0b82E33bB0A388a43;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant LOCKED_POSITION_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;

    DeployMainnetDeepFullRangeInfrastructureV2 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);
        deployment = new DeployMainnetDeepFullRangeInfrastructureV2();
    }

    function test_v2DependencyAndSourcePreflightPassOnPinnedMainnetSnapshot() public view {
        deployment.validateOfficialDependencies();
        assertEq(
            deployment.deploymentSourceCommitment(), 0xae0ebe9d2023c86e0fe54153675fdc7a9c7694132ef769359680beec2ef44940
        );
    }

    function test_v2PlanReusesTheVerifiedSharedStackAndDeploysExactlyTwoTransactions() public {
        DeployMainnetDeepFullRangeInfrastructureV2.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        DeployMainnetDeepFullRangeInfrastructureV2.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);

        assertEq(plan.feeSplitVaultFactory, FEE_SPLIT_VAULT_FACTORY);
        assertEq(plan.hookFactory, HOOK_FACTORY);
        assertEq(plan.feeHook, FEE_HOOK);
        assertEq(plan.rangeSourceFactory, RANGE_SOURCE_FACTORY);
        assertEq(address(result.feeSplitVaultFactory), FEE_SPLIT_VAULT_FACTORY);
        assertEq(address(result.hookFactory), HOOK_FACTORY);
        assertEq(address(result.feeHook), FEE_HOOK);
        assertEq(address(result.rangeSourceFactory), RANGE_SOURCE_FACTORY);
        assertEq(address(result.growthVaultFactory), plan.growthVaultFactory);
        assertEq(result.growthVaultFactory.implementation(), plan.growthVaultImplementation);
        assertEq(address(result.launcher), plan.launcher);
        assertEq(address(result.automation), plan.automation);
        assertEq(address(result.positionPlanner), plan.positionPlanner);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment());
        assertEq(vm.getNonce(DEPLOYER), 2);
    }

    function test_v2MainnetForkRehearsalUsesOnlyTheExactV2Stack() public {
        DeployMainnetDeepFullRangeInfrastructureV2.DeploymentResult memory infrastructure =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);
        LiquidityGrowthFullRangeLaunchV2 launcher = infrastructure.launcher;
        address creator = makeAddr("deepV2ReleaseCreator");
        vm.deal(creator, 1 ether);

        LiquidityGrowthFullRangeLaunchV2.LaunchParameters memory parameters =
            LiquidityGrowthFullRangeLaunchV2.LaunchParameters({
                name: "Deep V2 Release",
                symbol: "DEEPV2",
                creatorSalt: keccak256("deep-full-range-v2-release-fork"),
                metadata: UERC20Metadata({
                    description: "Deep V2 exact release rehearsal",
                    website: "https://programmable.family",
                    image: "ipfs://programmable-deep-v2-release",
                    extraData: bytes('{"v":2,"model":"deep"}')
                })
            });

        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        uint256 minimumInitialBuy = launcher.MIN_INITIAL_BUY_WEI();
        vm.prank(creator);
        LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result =
            launcher.launch{ value: minimumInitialBuy }(parameters);
        LiquidityGrowthFullRangeVaultV2 vault = LiquidityGrowthFullRangeVaultV2(payable(result.growthVault));

        assertEq(result.token, predictedToken);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(IERC20(result.token).balanceOf(address(vault)), launcher.TOKEN_RESERVE_TARGET());
        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(vault.creator(), creator);
        assertEq(vault.beneficiaryCount(), 1);
        assertEq(vault.beneficiaryAt(0), creator);
        assertEq(vault.shareBpsOf(creator), 10_000);
        assertEq(address(vault.FACTORY()), address(infrastructure.growthVaultFactory));
        assertTrue(infrastructure.automation.isRegisteredVault(address(vault)));
        assertTrue(infrastructure.growthVaultFactory.isFactoryVault(address(vault)));
        assertTrue(infrastructure.hookFactory.isFactoryHook(address(infrastructure.feeHook)));
        assertTrue(
            LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY).isFactoryForwarder(result.positionRecipient)
        );
        (uint256 creatorFee, uint256 programmableFee) = infrastructure.feeHook.quoteGrossFees(1 ether, 100);
        assertEq(creatorFee, 0.009 ether);
        assertEq(programmableFee, 0.001 ether);
        assertEq(address(launcher).balance, 0);
    }

    function test_v2RejectsStaleNonceAndWrongTreasury() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV2.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1, TREASURY);

        address wrongTreasury = makeAddr("wrongDeepV2Treasury");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV2.UnexpectedTreasury.selector, wrongTreasury, TREASURY
            )
        );
        deployment.deployReviewed(DEPLOYER, 0, wrongTreasury);
    }
}
