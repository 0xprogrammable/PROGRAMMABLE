// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Test } from "forge-std/Test.sol";

import { DeployClassicV3InfrastructureV1 } from "../../script/DeployClassicV3InfrastructureV1.s.sol";
import { MemeLaunchV2 } from "../../src/MemeLaunchV2.sol";

abstract contract DeployClassicV3InfrastructureV1ForkBase is Test {
    address internal constant DEPLOYER = 0xA11Ce00000000000000000000000000000000003;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint256 internal constant MIN_INITIAL_BUY = 0.0006 ether;

    DeployClassicV3InfrastructureV1 internal deployment;

    function _selectFork(string memory environmentKey, string memory fallbackRpc, uint256 blockNumber) internal {
        vm.createSelectFork(vm.envOr(environmentKey, fallbackRpc), blockNumber);
        vm.deal(DEPLOYER, 10 ether);
        deployment = new DeployClassicV3InfrastructureV1();
    }

    function _assertDeterministicDeploymentAndLaunch() internal {
        DeployClassicV3InfrastructureV1.DeploymentPlan memory plan = deployment.deploymentPlan(DEPLOYER, 0);
        DeployClassicV3InfrastructureV1.DeploymentResult memory result =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);

        assertEq(plan.chainId, block.chainid);
        assertEq(address(result.feeSplitVaultFactory), plan.feeSplitVaultFactory);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.feeHook), plan.feeHook);
        assertEq(address(result.launcher), plan.launcher);
        assertEq(result.hookSalt, plan.hookSalt);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment());
        assertEq(vm.getNonce(DEPLOYER), 4);
        assertEq(deployment.predictHook(plan.hookFactory, plan.feeSplitVaultFactory, plan.hookSalt), plan.feeHook);

        address creator = makeAddr("classicV3DeploymentCreator");
        vm.deal(creator, MIN_INITIAL_BUY);
        MemeLaunchV2.LaunchParameters memory parameters = _parameters();
        vm.prank(creator);
        MemeLaunchV2.LaunchResult memory launchResult = result.launcher.launch{ value: MIN_INITIAL_BUY }(parameters);

        assertGt(launchResult.initialBuyTokenAmount, 0);
        assertEq(IERC20(launchResult.token).balanceOf(creator), launchResult.initialBuyTokenAmount);
        assertEq(address(result.launcher).balance, 0);
        assertEq(
            IERC721(address(result.launcher.positionManager())).ownerOf(launchResult.positionTokenId),
            launchResult.positionRecipient
        );
        assertGt(
            IPositionManager(address(result.launcher.positionManager()))
                .getPositionLiquidity(launchResult.positionTokenId),
            0
        );

        (address rewardVault,,,, bool registered,) = result.feeHook.poolFeeConfig(launchResult.poolId);
        assertTrue(registered);
        assertEq(rewardVault, launchResult.rewardVault);
        assertEq(result.feeHook.launcherFeeRecipient(), TREASURY);
        assertEq(result.feeHook.TRANSFER_TAX_BPS(), 0);
        assertEq(result.feeHook.LP_FEE_PIPS(), 0);
    }

    function _parameters() private view returns (MemeLaunchV2.LaunchParameters memory parameters) {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = DEPLOYER;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        parameters = MemeLaunchV2.LaunchParameters({
            name: "Programmable Classic Deployment Rehearsal",
            symbol: "PCDR",
            buySwapFeeBps: 200,
            sellSwapFeeBps: 700,
            creatorSalt: keccak256(abi.encode(block.chainid, "classic-v3-deployment-rehearsal")),
            metadata: UERC20Metadata({
                description: "Deterministic Classic deployment rehearsal",
                website: "https://programmable.family",
                image: "ipfs://programmable-classic-deployment-rehearsal",
                extraData: bytes('{"v":1,"model":"classic"}')
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares
        });
    }
}
