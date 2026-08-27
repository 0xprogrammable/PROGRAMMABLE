// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { Test } from "forge-std/Test.sol";

import { DeployClassicV4InfrastructureV1 } from "../../script/DeployClassicV4InfrastructureV1.s.sol";
import {
    ClassicInitialBuyCustodyConfig,
    ClassicInitialBuyCustodyMode
} from "../../src/ClassicInitialBuyVestingWalletV1.sol";
import { MemeLaunchV3 } from "../../src/MemeLaunchV3.sol";
import { ClassicGraduationVaultV1 } from "../../src/ClassicGraduationVaultV1.sol";

abstract contract DeployClassicV4InfrastructureV1ForkBase is Test {
    using PoolIdLibrary for PoolKey;

    address internal constant DEPLOYER = 0xa11CE00000000000000000000000000000000004;
    uint256 internal constant MIN_INITIAL_BUY = 0.0006 ether;

    DeployClassicV4InfrastructureV1 internal deployment;

    function _selectFork(string memory environmentKey, string memory fallbackRpc, uint256 blockNumber) internal {
        vm.createSelectFork(vm.envOr(environmentKey, fallbackRpc), blockNumber);
        vm.deal(DEPLOYER, 10 ether);
        deployment = new DeployClassicV4InfrastructureV1();
    }

    function _approve(DeployClassicV4InfrastructureV1.Inputs memory inputs) internal {
        string memory prefix = block.chainid == 1 ? "CLASSIC_V4_MAINNET_" : "CLASSIC_V4_SEPOLIA_";
        vm.setEnv(string.concat(prefix, "OWNER_APPROVED"), "true");
        vm.setEnv(string.concat(prefix, "DEPLOYER"), vm.toString(DEPLOYER));
        vm.setEnv(string.concat(prefix, "START_NONCE"), "0");
        vm.setEnv(
            string.concat(prefix, "LAUNCHER_FEE_RECIPIENT"), vm.toString(deployment.expectedLauncherFeeRecipient())
        );
        vm.setEnv(
            string.concat(prefix, "SOURCE_COMMITMENT"), vm.toString(deployment.deploymentSourceCommitment(inputs))
        );
        vm.setEnv(string.concat(prefix, "CTO_AUTHORITY"), vm.toString(inputs.ctoAuthority));
        vm.setEnv(string.concat(prefix, "REWARD_VAULT_FACTORY"), vm.toString(inputs.rewardVaultFactory));
        vm.setEnv(
            string.concat(prefix, "INITIAL_BUY_VESTING_WALLET_FACTORY"),
            vm.toString(inputs.initialBuyVestingWalletFactory)
        );
        vm.setEnv(string.concat(prefix, "LAUNCH_POLICY"), vm.toString(inputs.launchPolicy));
        vm.setEnv(string.concat(prefix, "POSITION_FORWARDER_FACTORY"), vm.toString(inputs.positionForwarderFactory));
    }

    function _assertDeterministicDeploymentAndLaunch(uint8 liquidityPreset) internal {
        DeployClassicV4InfrastructureV1.Inputs memory inputs = deployment.expectedInputs();
        deployment.validateOfficialDependencies();
        deployment.validateSharedDependencies(inputs);
        _approve(inputs);

        DeployClassicV4InfrastructureV1.DeploymentPlan memory plan = deployment.deploymentPlan(inputs, DEPLOYER, 0);
        DeployClassicV4InfrastructureV1.DeploymentResult memory result = deployment.run();

        _assertDeployment(plan, result, inputs);
        _launchAndAssert(result, liquidityPreset);
    }

    function _assertDeployment(
        DeployClassicV4InfrastructureV1.DeploymentPlan memory plan,
        DeployClassicV4InfrastructureV1.DeploymentResult memory result,
        DeployClassicV4InfrastructureV1.Inputs memory inputs
    ) private view {
        assertEq(plan.chainId, block.chainid);
        assertEq(address(result.hookFactory), plan.hookFactory);
        assertEq(address(result.feeHook), plan.feeHook);
        assertEq(address(result.positionPlanner), plan.positionPlanner);
        assertEq(address(result.graduationVaultFactory), plan.graduationVaultFactory);
        assertEq(address(result.launcher), plan.launcher);
        assertEq(result.hookSalt, plan.hookSalt);
        assertEq(result.sourceCommitment, plan.sourceCommitment);
        assertEq(result.sourceCommitment, deployment.deploymentSourceCommitment(inputs));
        assertEq(vm.getNonce(DEPLOYER), 5);
        assertEq(deployment.predictHook(plan.hookFactory, inputs, plan.hookSalt), plan.feeHook);
        assertEq(result.hookFactoryRuntimeCodeHash, address(result.hookFactory).codehash);
        assertEq(result.feeHookRuntimeCodeHash, address(result.feeHook).codehash);
        assertEq(result.positionPlannerRuntimeCodeHash, address(result.positionPlanner).codehash);
        assertEq(result.graduationVaultFactoryRuntimeCodeHash, address(result.graduationVaultFactory).codehash);
        assertEq(result.launcherRuntimeCodeHash, address(result.launcher).codehash);
    }

    function _launchAndAssert(DeployClassicV4InfrastructureV1.DeploymentResult memory result, uint8 liquidityPreset)
        private
    {
        address creator = makeAddr(
            liquidityPreset == result.launcher.BONDING_LIQUIDITY_PRESET()
                ? "classicV4BondingCreator"
                : "classicV4Creator"
        );
        vm.deal(creator, MIN_INITIAL_BUY);
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(creator, liquidityPreset);
        vm.prank(creator);
        MemeLaunchV3.LaunchResult memory launchResult = result.launcher.launch{ value: MIN_INITIAL_BUY }(parameters);

        assertGt(launchResult.initialBuyTokenAmount, 0);
        assertEq(IERC20(launchResult.token).balanceOf(creator), launchResult.initialBuyTokenAmount);
        assertEq(address(result.launcher).balance, 0);
        assertEq(launchResult.tokenLiquidityAmount + launchResult.lockedTokenDust, result.launcher.TOKEN_SUPPLY());
        assertEq(result.launcher.launchHashOf(launchResult.token), launchResult.launchHash);
        assertEq(result.launcher.rewardVaultOf(launchResult.token), launchResult.rewardVault);

        _assertPosition(result, launchResult, liquidityPreset, creator);
        _assertFees(result, launchResult);
    }

    function _assertPosition(
        DeployClassicV4InfrastructureV1.DeploymentResult memory result,
        MemeLaunchV3.LaunchResult memory launchResult,
        uint8 liquidityPreset,
        address creator
    ) private view {
        IPositionManager positionManager = IPositionManager(address(result.launcher.positionManager()));
        assertEq(
            IERC721(address(positionManager)).ownerOf(launchResult.positionTokenId), launchResult.positionRecipient
        );
        assertGt(positionManager.getPositionLiquidity(launchResult.positionTokenId), 0);
        (PoolKey memory positionKey, PositionInfo positionInfo) =
            positionManager.getPoolAndPositionInfo(launchResult.positionTokenId);
        PoolKey memory launchKey = result.launcher.poolKey(launchResult.token);
        assertEq(PoolId.unwrap(positionKey.toId()), launchResult.poolId);
        assertEq(PoolId.unwrap(launchKey.toId()), launchResult.poolId);
        assertEq(Currency.unwrap(launchKey.currency0), address(0));
        assertEq(Currency.unwrap(launchKey.currency1), launchResult.token);
        assertEq(launchKey.fee, 0);
        assertEq(launchKey.tickSpacing, 200);
        assertEq(address(launchKey.hooks), address(result.feeHook));
        assertEq(positionInfo.tickUpper(), result.launcher.INITIAL_TICK());
        assertEq(positionInfo.tickLower(), result.positionPlanner.tickLowerForPreset(liquidityPreset));

        address finalRecipient = liquidityPreset == result.launcher.BONDING_LIQUIDITY_PRESET()
            ? launchResult.finalPositionRecipient
            : launchResult.positionRecipient;
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(finalRecipient));
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);

        if (liquidityPreset == result.launcher.BONDING_LIQUIDITY_PRESET()) {
            ClassicGraduationVaultV1 vault = ClassicGraduationVaultV1(payable(launchResult.graduationVault));
            assertEq(launchResult.positionRecipient, launchResult.graduationVault);
            assertEq(result.launcher.graduationVaultOf(launchResult.token), launchResult.graduationVault);
            assertEq(result.launcher.finalPositionRecipientOf(launchResult.token), launchResult.finalPositionRecipient);
            assertEq(launchResult.graduationReserveAmount, 200_000_000 ether);
            assertEq(IERC20(launchResult.token).balanceOf(address(vault)), launchResult.lockedTokenDust);
            assertEq(vault.bondingPositionTokenId(), launchResult.positionTokenId);
            assertEq(vault.finalPositionRecipient(), launchResult.finalPositionRecipient);
            assertFalse(vault.graduated());
        } else {
            assertEq(launchResult.graduationVault, address(0));
            assertEq(launchResult.finalPositionRecipient, launchResult.positionRecipient);
        }
    }

    function _assertFees(
        DeployClassicV4InfrastructureV1.DeploymentResult memory result,
        MemeLaunchV3.LaunchResult memory launchResult
    ) private view {
        (address rewardVault,, uint16 buyFeeBps, uint16 sellFeeBps, bool registered, uint256 creatorFeesAccrued) =
            result.feeHook.poolFeeConfig(launchResult.poolId);
        assertTrue(registered);
        assertEq(rewardVault, launchResult.rewardVault);
        assertEq(buyFeeBps, 10);
        assertEq(sellFeeBps, 1000);
        assertEq(creatorFeesAccrued, 0);
        assertGt(result.feeHook.launcherFeesAccrued(), 0);

        (uint16 buy, uint16 sell, uint16 buyCreator, uint16 sellCreator, uint16 launcherFee,,,) =
            result.feeHook.feeDisclosure(launchResult.poolId);
        assertEq(buy, 10);
        assertEq(sell, 1000);
        assertEq(buyCreator, 0);
        assertEq(sellCreator, 990);
        assertEq(launcherFee, 10);
    }

    function _parameters(address creator, uint8 liquidityPreset)
        private
        view
        returns (MemeLaunchV3.LaunchParameters memory parameters)
    {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        parameters = MemeLaunchV3.LaunchParameters({
            name: liquidityPreset == 1 ? "Programmable Classic V4 Bonding" : "Programmable Classic V4 Standard",
            symbol: liquidityPreset == 1 ? "PCB4" : "PCS4",
            buySwapFeeBps: 10,
            sellSwapFeeBps: 1000,
            liquidityPreset: liquidityPreset,
            creatorSalt: keccak256(
                abi.encode(block.chainid, creator, liquidityPreset, "classic-v4-deployment-rehearsal")
            ),
            metadata: UERC20Metadata({
                description: "Additive Classic V4 deployment rehearsal",
                website: "https://programmable.market",
                image: "ipfs://programmable-classic-v4-deployment-rehearsal",
                extraData: bytes('{"v":1,"model":"classic","release":"classic-v4"}')
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares,
            initialBuyCustody: ClassicInitialBuyCustodyConfig({
                mode: ClassicInitialBuyCustodyMode.Unlocked, durationDays: 0, cliffDays: 0
            })
        });
    }
}
