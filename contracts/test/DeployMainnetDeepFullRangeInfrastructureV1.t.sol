// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { Test } from "forge-std/Test.sol";

import { DeployMainnetDeepFullRangeInfrastructureV1 } from "../script/DeployMainnetDeepFullRangeInfrastructureV1.s.sol";
import { LiquidityGrowthFullRangeLaunchV1 } from "../src/LiquidityGrowthFullRangeLaunchV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "../src/LiquidityGrowthFullRangeVaultV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";

contract DeployMainnetDeepFullRangeInfrastructureV1Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_622_180;
    address internal constant DEPLOYER = 0xDEEF000000000000000000000000000000000001;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant LOCKED_POSITION_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;

    DeployMainnetDeepFullRangeInfrastructureV1 internal deployment;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);
        deployment = new DeployMainnetDeepFullRangeInfrastructureV1();
    }

    function test_dependencyAndSourcePreflightPassOnPinnedMainnetSnapshot() public view {
        deployment.validateOfficialDependencies();
        assertTrue(deployment.deploymentSourceCommitment() != bytes32(0));
    }

    function test_planAndSixTransactionDeploymentAreDeterministic() public {
        DeployMainnetDeepFullRangeInfrastructureV1.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        DeployMainnetDeepFullRangeInfrastructureV1.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);

        assertEq(address(result.feeSplitVaultFactory), plan.feeSplitVaultFactory);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.feeHook), plan.feeHook);
        assertEq(address(result.rangeSourceFactory), plan.rangeSourceFactory);
        assertEq(address(result.growthVaultFactory), plan.growthVaultFactory);
        assertEq(result.growthVaultFactory.implementation(), plan.growthVaultImplementation);
        assertEq(address(result.launcher), plan.launcher);
        assertEq(address(result.automation), plan.automation);
        assertEq(address(result.positionPlanner), plan.positionPlanner);
        assertEq(result.hookSalt, plan.hookSalt);
        assertEq(result.hookInitCodeHash, plan.hookInitCodeHash);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment());
        assertEq(vm.getNonce(DEPLOYER), 6);
        assertEq(
            deployment.predictHook(address(result.hookFactory), address(result.feeSplitVaultFactory), result.hookSalt),
            address(result.feeHook)
        );
    }

    function test_mainnetForkRehearsalUsesTheExactDeployedInfrastructure() public {
        DeployMainnetDeepFullRangeInfrastructureV1.DeploymentResult memory infrastructure =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);
        LiquidityGrowthFullRangeLaunchV1 launcher = infrastructure.launcher;
        address creator = makeAddr("deepFullRangeReleaseCreator");
        vm.deal(creator, 1 ether);

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        LiquidityGrowthFullRangeLaunchV1.LaunchParameters memory parameters =
            LiquidityGrowthFullRangeLaunchV1.LaunchParameters({
                name: "Deep FullRange Release",
                symbol: "DEEPF",
                buySwapFeeBps: 200,
                sellSwapFeeBps: 300,
                creatorSalt: keccak256("deep-full-range-release-fork"),
                metadata: UERC20Metadata({
                    description: "Deep FullRange V1 exact release rehearsal",
                    website: "https://programmable.family",
                    image: "ipfs://programmable-deep-full-range-release",
                    extraData: bytes('{"v":1,"model":"deep-full-range-v1"}')
                }),
                rewardBeneficiaries: beneficiaries,
                rewardSharesBps: shares
            });

        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        vm.prank(creator);
        LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result = launcher.launch{ value: 0.0006 ether }(parameters);
        LiquidityGrowthFullRangeVaultV1 vault = LiquidityGrowthFullRangeVaultV1(payable(result.growthVault));

        assertEq(result.token, predictedToken);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(IERC20(result.token).balanceOf(address(vault)), launcher.TOKEN_RESERVE_TARGET());
        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(address(vault.FACTORY()), address(infrastructure.growthVaultFactory));
        assertTrue(infrastructure.automation.isRegisteredVault(address(vault)));
        assertTrue(infrastructure.growthVaultFactory.isFactoryVault(address(vault)));
        assertTrue(infrastructure.hookFactory.isFactoryHook(address(infrastructure.feeHook)));
        assertTrue(
            LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY).isFactoryForwarder(result.positionRecipient)
        );
        assertEq(address(launcher).balance, 0);
    }

    function test_rejectsStaleNonceAndWrongTreasury() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV1.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1, TREASURY);

        address wrongTreasury = makeAddr("wrongDeepTreasury");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetDeepFullRangeInfrastructureV1.UnexpectedTreasury.selector, wrongTreasury, TREASURY
            )
        );
        deployment.deployReviewed(DEPLOYER, 0, wrongTreasury);
    }
}
