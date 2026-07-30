// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { Test } from "forge-std/Test.sol";

import { DeployMainnetStockPairedInfrastructureV2 } from "../script/DeployMainnetStockPairedInfrastructureV2.s.sol";
import { StockPairedEthLaunchCoordinatorV1 } from "../src/StockPairedEthLaunchCoordinatorV1.sol";
import { StockPairedLaunchV1 } from "../src/StockPairedLaunchV1.sol";

contract DeployMainnetStockPairedInfrastructureV2Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_640_034;
    address internal constant DEPLOYER = 0xa11ce00000000000000000000000000000000001;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant ONDO_GM_TOKEN_MANAGER = 0x2c158BC456e027b2AfFCCadF1BDBD9f5fC4c5C8c;
    address internal constant BABA_ON = 0x41765F0FCddC276309195166C7A62AE522FA09ef;

    DeployMainnetStockPairedInfrastructureV2 internal deployment;

    function setUp() public {
        vm.createSelectFork(vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org")), SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);
        deployment = new DeployMainnetStockPairedInfrastructureV2();
    }

    function test_dependencyPlanAndSevenTransactionDeploymentAreExact() public {
        deployment.validateOfficialDependencies();
        DeployMainnetStockPairedInfrastructureV2.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        DeployMainnetStockPairedInfrastructureV2.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);

        assertEq(address(result.quoteRegistry), plan.quoteRegistry);
        assertEq(address(result.positionPlanner), plan.positionPlanner);
        assertEq(address(result.feeSplitVaultFactory), plan.feeSplitVaultFactory);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.feeHook), plan.feeHook);
        assertEq(address(result.launcher), plan.launcher);
        assertEq(address(result.ethLaunchCoordinator), plan.ethLaunchCoordinator);
        assertEq(result.hookSalt, plan.hookSalt);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment());
        assertEq(vm.getNonce(DEPLOYER), 7);
        assertEq(result.quoteRegistry.assetCount(), 11);
        assertEq(address(result.quoteRegistry.gmTokenManager()), ONDO_GM_TOKEN_MANAGER);
        assertTrue(result.quoteRegistry.isSupported(BABA_ON));
        assertTrue(result.quoteRegistry.assertAssetReady(BABA_ON) != bytes32(0));
        assertEq(
            deployment.predictHook(plan.hookFactory, plan.quoteRegistry, plan.feeSplitVaultFactory, plan.hookSalt),
            plan.feeHook
        );
    }

    function test_deployedStackCompletesAnAtomicStockPairedLaunch() public {
        DeployMainnetStockPairedInfrastructureV2.DeploymentResult memory infrastructure =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);
        StockPairedLaunchV1 launcher = infrastructure.launcher;
        address creator = makeAddr("stockPairedDeploymentRehearsalCreator");
        uint256 initialBuy = 0.02 ether;
        deal(BABA_ON, creator, 1 ether, true);
        vm.prank(creator);
        IERC20(BABA_ON).approve(address(launcher), initialBuy);

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory sharesBps = new uint16[](1);
        sharesBps[0] = 10_000;
        StockPairedLaunchV1.LaunchParameters memory parameters = StockPairedLaunchV1.LaunchParameters({
            name: "Stock Paired Deployment Rehearsal",
            symbol: "SPDR",
            quoteAsset: BABA_ON,
            initialBuyQuoteAmount: initialBuy,
            creatorSalt: keccak256("stock-paired-deployment-rehearsal-v2"),
            metadata: UERC20Metadata({
                description: "Stock-Paired deployment rehearsal",
                website: "https://programmable.family",
                image: "ipfs://stock-paired-deployment-rehearsal",
                extraData: bytes('{"v":1,"model":"stock-paired"}')
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: sharesBps
        });

        vm.prank(creator);
        StockPairedLaunchV1.LaunchResult memory result = launcher.launch(parameters);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(result.quoteAsset, BABA_ON);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();
    }

    function test_ethCoordinatorCompletesALaunchThroughTheNewAlibabaRoute() public {
        DeployMainnetStockPairedInfrastructureV2.DeploymentResult memory infrastructure =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);
        StockPairedEthLaunchCoordinatorV1 coordinator = infrastructure.ethLaunchCoordinator;
        address creator = makeAddr("stockPairedV2EthCreator");

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory sharesBps = new uint16[](1);
        sharesBps[0] = 10_000;
        StockPairedLaunchV1.LaunchParameters memory launch = StockPairedLaunchV1.LaunchParameters({
            name: "Alibaba Paired Launch",
            symbol: "BABAETH",
            quoteAsset: BABA_ON,
            initialBuyQuoteAmount: 0,
            creatorSalt: keccak256("stock-paired-v2-eth-route"),
            metadata: UERC20Metadata({
                description: "Stock-Paired V2 ETH route rehearsal",
                website: "https://programmable.family",
                image: "ipfs://stock-paired-v2-eth-route",
                extraData: bytes('{"v":2,"model":"stock-paired"}')
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: sharesBps
        });
        StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters =
            StockPairedEthLaunchCoordinatorV1.EthLaunchParameters({
                minimumQuoteAmountOut: 1,
                minimumInitialTokenOut: 1,
                deadline: block.timestamp + 10 minutes,
                launch: launch
            });

        vm.deal(creator, 0.02 ether);
        vm.prank(creator);
        StockPairedLaunchV1.LaunchResult memory result = coordinator.launch{ value: 0.01 ether }(parameters);

        assertEq(result.quoteAsset, BABA_ON);
        assertGt(result.initialBuyQuoteAmount, infrastructure.launcher.MIN_INITIAL_BUY_QUOTE_AMOUNT());
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(IERC20(BABA_ON).balanceOf(address(coordinator)), 0);
        assertEq(IERC20(result.token).balanceOf(address(coordinator)), 0);
    }

    function test_rejectsStaleNonceWrongTreasuryAndWrongChain() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetStockPairedInfrastructureV2.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1, TREASURY);

        address wrongTreasury = makeAddr("wrongStockPairedTreasury");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetStockPairedInfrastructureV2.UnexpectedTreasury.selector, wrongTreasury, TREASURY
            )
        );
        deployment.deployReviewed(DEPLOYER, 0, wrongTreasury);

        vm.chainId(8453);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetStockPairedInfrastructureV2.UnexpectedChain.selector, uint256(8453), uint256(1)
            )
        );
        deployment.validateOfficialDependencies();
    }
}
