// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DeployMainnetStockPairedInfrastructureV3 } from "../script/DeployMainnetStockPairedInfrastructureV3.s.sol";
import { StockPairedLaunchV3 } from "../src/StockPairedLaunchV3.sol";

contract DeployMainnetStockPairedInfrastructureV3Test is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_642_460;
    address internal constant DEPLOYER = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint64 internal constant STARTING_NONCE = 126;
    address internal constant EXPECTED_PLANNER = 0x92555fb6d357f95fdBc5AAAEC55912626297782D;
    address internal constant EXPECTED_LAUNCHER = 0x0573879f72d8eE8B0e5a4Ec5E8bcDb2fCab9E51c;
    address internal constant EXPECTED_COORDINATOR = 0xdDC3ABbAB0df7F1189310a4f70e7e365796B74E2;
    address internal constant NVDA_USDC_POOL = 0xf5294094BCe435bFbd0eC488be5C462aAF32Bc7A;
    address internal constant QQQ = 0x0e397938C1Aa0680954093495B70A9F5e2249aBa;

    DeployMainnetStockPairedInfrastructureV3 internal deployment;

    function setUp() public {
        vm.createSelectFork(vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org")), SNAPSHOT_BLOCK);
        vm.deal(DEPLOYER, 100 ether);
        deployment = new DeployMainnetStockPairedInfrastructureV3();
    }

    function test_dependencyPricePlanAndThreeCreateDeploymentAreExact() public {
        deployment.validateOfficialDependencies();
        deployment.validateSharedDependencies();
        bytes32 priceObservation = deployment.validateCurrentPriceDrift();
        assertTrue(priceObservation != bytes32(0));

        DeployMainnetStockPairedInfrastructureV3.DeploymentPlan memory plan =
            deployment.deploymentPlan(DEPLOYER, STARTING_NONCE);
        assertEq(plan.positionPlanner, EXPECTED_PLANNER);
        assertEq(plan.launcher, EXPECTED_LAUNCHER);
        assertEq(plan.ethLaunchCoordinator, EXPECTED_COORDINATOR);
        assertEq(plan.sourceCommitment, deployment.deploymentSourceCommitment());
        assertEq(plan.economicsCommitment, deployment.economicsCommitment());
        assertEq(plan.priceCommitment, deployment.priceCommitment());
        assertEq(vm.getNonce(DEPLOYER), STARTING_NONCE);

        DeployMainnetStockPairedInfrastructureV3.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, STARTING_NONCE, TREASURY);

        assertEq(address(result.positionPlanner), EXPECTED_PLANNER);
        assertEq(address(result.launcher), EXPECTED_LAUNCHER);
        assertEq(address(result.ethLaunchCoordinator), EXPECTED_COORDINATOR);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.economicsCommitment, plan.economicsCommitment);
        assertEq(result.priceCommitment, plan.priceCommitment);
        assertTrue(result.preDeploymentPriceObservation != bytes32(0));
        assertTrue(result.postDeploymentPriceObservation != bytes32(0));
        assertEq(vm.getNonce(DEPLOYER), STARTING_NONCE + 3);

        vm.expectRevert(abi.encodeWithSelector(StockPairedLaunchV3.UnsupportedPriceConfiguration.selector, QQQ));
        result.launcher.initialAbsoluteTickFor(QQQ);
    }

    function test_dependencyRuntimeDriftFailsClosed() public {
        vm.etch(deployment.V3_SWAP_ROUTER(), hex"00");
        vm.expectPartialRevert(DeployMainnetStockPairedInfrastructureV3.UnexpectedCodeHash.selector);
        deployment.validateOfficialDependencies();
    }

    function test_currentPriceDriftFailsClosed() public {
        vm.mockCall(
            NVDA_USDC_POOL,
            abi.encodeWithSignature("slot0()"),
            abi.encode(uint160(1), int24(0), uint16(0), uint16(1), uint16(1), uint8(0), true)
        );
        vm.expectPartialRevert(DeployMainnetStockPairedInfrastructureV3.CurrentPriceDriftExceeded.selector);
        deployment.validateCurrentPriceDrift();
    }

    function test_zeroAndUnreviewedDeployersFailClosed() public {
        vm.expectRevert(
            abi.encodeWithSelector(DeployMainnetStockPairedInfrastructureV3.InvalidBroadcaster.selector, address(0))
        );
        deployment.deployReviewed(address(0), STARTING_NONCE, TREASURY);

        vm.expectPartialRevert(DeployMainnetStockPairedInfrastructureV3.UnexpectedAddress.selector);
        deployment.deployReviewed(address(0xBEEF), STARTING_NONCE, TREASURY);
    }

    function test_wrongReviewedStartingNonceFailsClosed() public {
        vm.expectPartialRevert(DeployMainnetStockPairedInfrastructureV3.UnexpectedValue.selector);
        deployment.deployReviewed(DEPLOYER, STARTING_NONCE + 1, TREASURY);
    }

    function test_currentNonceDriftFailsClosed() public {
        vm.setNonce(DEPLOYER, STARTING_NONCE + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetStockPairedInfrastructureV3.UnexpectedNonce.selector,
                DEPLOYER,
                STARTING_NONCE + 1,
                STARTING_NONCE
            )
        );
        deployment.deployReviewed(DEPLOYER, STARTING_NONCE, TREASURY);
    }

    function test_wrongTreasuryFailsClosed() public {
        address wrongTreasury = address(0xBEEF);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployMainnetStockPairedInfrastructureV3.UnexpectedTreasury.selector, wrongTreasury, TREASURY
            )
        );
        deployment.deployReviewed(DEPLOYER, STARTING_NONCE, wrongTreasury);
    }
}
