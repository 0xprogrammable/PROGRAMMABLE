// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionDescriptor } from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IWETH9 } from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";

import { LiquidityGrowthFeeOracleHookFactoryV2 } from "../src/LiquidityGrowthFeeOracleHookFactoryV2.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangeAutomationV3 } from "../src/LiquidityGrowthFullRangeAutomationV3.sol";
import { LiquidityGrowthFullRangeLaunchV3 } from "../src/LiquidityGrowthFullRangeLaunchV3.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultFactoryV3 } from "../src/LiquidityGrowthFullRangeVaultFactoryV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../src/LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthZapPlannerV3 } from "../src/LiquidityGrowthZapPlannerV3.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import {
    ILiquidityGrowthFeeOracleHookV2,
    ILiquidityGrowthFullRangeVaultFactoryV3
} from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

contract LiquidityGrowthFullRangeLaunchV3Test is Deployers {
    using StateLibrary for IPoolManager;

    uint256 private constant INITIAL_BUY = 0.0006 ether;
    bytes32 private constant CREATOR_SALT = keccak256("deep-v3-launch");

    IPositionManager private positionManager;
    UERC20Factory private tokenFactory;
    LiquidityGrowthZapPlannerV3 private zapPlanner;
    LiquidityGrowthFullRangeVaultFactoryV3 private vaultFactory;
    LiquidityGrowthFeeOracleHookFactoryV2 private hookFactory;
    LiquidityGrowthFeeOracleHookV2 private hook;
    LockedPositionFeeForwarderFactoryV1 private positionForwarderFactory;
    LiquidityGrowthFullRangeLaunchV3 private launcher;
    LiquidityGrowthFullRangeAutomationV3 private automation;

    address private creator;
    address private treasury;

    function setUp() public {
        deployFreshManagerAndRouters();
        positionManager = IPositionManager(
            address(
                new PositionManager(
                    manager,
                    IAllowanceTransfer(address(0)),
                    uint256(0),
                    IPositionDescriptor(address(0)),
                    IWETH9(address(0))
                )
            )
        );
        tokenFactory = new UERC20Factory();
        zapPlanner = new LiquidityGrowthZapPlannerV3();
        vaultFactory = new LiquidityGrowthFullRangeVaultFactoryV3(zapPlanner);
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV2();
        treasury = makeAddr("deepV3LaunchTreasury");
        hook = _deployHook();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        launcher = new LiquidityGrowthFullRangeLaunchV3(
            manager, positionManager, tokenFactory, hook, vaultFactory, positionForwarderFactory
        );
        automation = launcher.automation();

        creator = makeAddr("deepV3LaunchCreator");
        vm.deal(creator, 10 ether);
    }

    function test_launchAtomicallyCreatesCompleteSupplyLockedPoolAndProtectedInitialBuy() public {
        LiquidityGrowthFullRangeLaunchV3.LaunchParameters memory parameters = _parameters(CREATOR_SALT);
        (address predictedToken, bytes32 expectedGraffiti) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);

        vm.prank(creator);
        LiquidityGrowthFullRangeLaunchV3.LaunchResult memory result = launcher.launch{ value: INITIAL_BUY }(parameters);

        _assertLaunchRecord(result, parameters, predictedToken);
        _assertTokenSupply(result, expectedGraffiti);
        _assertLockedPosition(result);
        _assertFeeAccounting(result);
        _assertOracleAndAutomation(result, parameters.initialBuySqrtPriceLimitX96);
    }

    function test_minimumOutputFailureRollsBackEveryDeploymentAndFee() public {
        LiquidityGrowthFullRangeLaunchV3.LaunchParameters memory parameters =
            _parameters(keccak256("deep-v3-impossible-output"));
        parameters.minimumInitialTokenOut = type(uint256).max;
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);

        vm.prank(creator);
        vm.expectRevert();
        launcher.launch{ value: INITIAL_BUY }(parameters);

        assertEq(predictedToken.code.length, 0);
        assertEq(hook.totalNativeFeesAccrued(), 0);
        assertEq(automation.registeredVaultCount(), 0);
    }

    function test_rejectsExpiredDeadlineZeroOutputFloorAndUnsafePriceLimits() public {
        LiquidityGrowthFullRangeLaunchV3.LaunchParameters memory parameters =
            _parameters(keccak256("deep-v3-invalid-protection"));
        uint160 minimumLimit = launcher.MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96();
        uint160 initialPrice = Policy.initialSqrtPriceX96();

        parameters.deadline = block.timestamp - 1;
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeLaunchV3.LaunchDeadlineExpired.selector, parameters.deadline, block.timestamp
            )
        );
        launcher.launch{ value: INITIAL_BUY }(parameters);

        parameters.deadline = block.timestamp + 1 hours;
        parameters.minimumInitialTokenOut = 0;
        vm.prank(creator);
        vm.expectRevert(LiquidityGrowthFullRangeLaunchV3.InvalidMinimumTokenOutput.selector);
        launcher.launch{ value: INITIAL_BUY }(parameters);

        parameters.minimumInitialTokenOut = 1;
        parameters.initialBuySqrtPriceLimitX96 = Policy.initialSqrtPriceX96();
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeLaunchV3.InvalidInitialBuyPriceLimit.selector,
                parameters.initialBuySqrtPriceLimitX96,
                minimumLimit,
                initialPrice
            )
        );
        launcher.launch{ value: INITIAL_BUY }(parameters);

        parameters.initialBuySqrtPriceLimitX96 =
            TickMath.getSqrtPriceAtTick(Policy.INITIAL_TICK - Policy.MAX_ABS_OBSERVATION_TICK_DELTA - 1);
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeLaunchV3.InvalidInitialBuyPriceLimit.selector,
                parameters.initialBuySqrtPriceLimitX96,
                minimumLimit,
                initialPrice
            )
        );
        launcher.launch{ value: INITIAL_BUY }(parameters);
    }

    function test_rejectsInitialBuyBelowFixedMinimumBeforeCreatingToken() public {
        LiquidityGrowthFullRangeLaunchV3.LaunchParameters memory parameters =
            _parameters(keccak256("deep-v3-small-buy"));
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFullRangeLaunchV3.InitialBuyBelowMinimum.selector,
                Policy.MIN_INITIAL_BUY_WEI - 1,
                Policy.MIN_INITIAL_BUY_WEI
            )
        );
        launcher.launch{ value: Policy.MIN_INITIAL_BUY_WEI - 1 }(parameters);

        assertEq(predictedToken.code.length, 0);
    }

    function _assertLaunchRecord(
        LiquidityGrowthFullRangeLaunchV3.LaunchResult memory result,
        LiquidityGrowthFullRangeLaunchV3.LaunchParameters memory parameters,
        address predictedToken
    ) private view {
        PoolKey memory key = launcher.poolKey(result.token);
        LiquidityGrowthFullRangeVaultV3 vault = LiquidityGrowthFullRangeVaultV3(payable(result.growthVault));
        assertEq(result.token, predictedToken);
        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(result.initialBuyNativeAmount, INITIAL_BUY);
        assertGe(result.initialBuyTokenAmount, parameters.minimumInitialTokenOut);
        assertEq(result.initialLockedTokenDust, vault.initialTokenDust());
        assertEq(result.initialLockedTokenDust, vault.accountedTokenDust());
        assertEq(result.vaultConfigurationHash, vault.configurationHash());
        assertEq(result.launchHash, launcher.launchHashOf(result.token));
        assertEq(result.growthVault, launcher.growthVaultOf(result.token));
    }

    function _assertTokenSupply(LiquidityGrowthFullRangeLaunchV3.LaunchResult memory result, bytes32 expectedGraffiti)
        private
        view
    {
        UERC20 token = UERC20(result.token);
        assertEq(token.creator(), address(launcher));
        assertEq(token.graffiti(), expectedGraffiti);
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), Policy.TOKEN_SUPPLY);
        assertEq(token.balanceOf(address(launcher)), 0);
        assertEq(token.balanceOf(address(positionManager)), 0);
        assertEq(token.balanceOf(result.growthVault), result.initialLockedTokenDust);
        assertEq(
            token.balanceOf(address(manager)) + token.balanceOf(creator) + token.balanceOf(result.growthVault),
            Policy.TOKEN_SUPPLY
        );
    }

    function _assertLockedPosition(LiquidityGrowthFullRangeLaunchV3.LaunchResult memory result) private {
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        uint128 positionLiquidity = positionManager.getPositionLiquidity(result.positionTokenId);
        assertGt(positionLiquidity, 0);
        assertEq(hook.initialPositionSaltByPool(result.poolId), bytes32(result.positionTokenId));
        (uint128 managerLiquidity,,) = manager.getPositionInfo(
            PoolId.wrap(result.poolId),
            address(positionManager),
            Policy.FULL_RANGE_TICK_LOWER,
            Policy.INITIAL_TICK,
            bytes32(result.positionTokenId)
        );
        assertEq(managerLiquidity, positionLiquidity);

        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertEq(address(forwarder.positionManager()), address(positionManager));
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), result.growthVault);
        assertTrue(positionForwarderFactory.isFactoryForwarder(result.positionRecipient));
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();
    }

    function _assertFeeAccounting(LiquidityGrowthFullRangeLaunchV3.LaunchResult memory result) private view {
        (address configuredVault, address registrar, uint8 lifecycle, uint256 growthFees) =
            hook.poolFeeConfig(result.poolId);
        (uint256 expectedGrowthFee, uint256 expectedProgrammableFee) = hook.quoteGrossFees(INITIAL_BUY);
        assertEq(configuredVault, result.growthVault);
        assertEq(registrar, address(launcher));
        assertEq(lifecycle, hook.LIFECYCLE_FINALIZED());
        assertEq(growthFees, expectedGrowthFee);
        assertEq(hook.launcherFeesAccrued(), expectedProgrammableFee);
        assertEq(hook.totalNativeFeesAccrued(), expectedGrowthFee + expectedProgrammableFee);
    }

    function _assertOracleAndAutomation(
        LiquidityGrowthFullRangeLaunchV3.LaunchResult memory result,
        uint160 initialBuySqrtPriceLimitX96
    ) private view {
        (uint160 sqrtPriceX96, int24 tick,,) = manager.getSlot0(PoolId.wrap(result.poolId));
        assertGe(sqrtPriceX96, initialBuySqrtPriceLimitX96);
        (uint32 oracleTimestamp, int24 oracleTick,,, bool initialized) =
            hook.observationsById(PoolId.wrap(result.poolId), 0);
        assertTrue(initialized);
        assertEq(oracleTimestamp, uint32(block.timestamp));
        assertEq(oracleTick, tick);

        assertTrue(automation.isRegisteredVault(result.growthVault));
        assertEq(automation.registeredVaultCount(), 1);
        assertEq(automation.registeredVaultAt(0), result.growthVault);
        (, uint16 cardinality, uint16 cardinalityNext) = hook.stateById(PoolId.wrap(result.poolId));
        assertEq(cardinality, 1);
        assertEq(cardinalityNext, 2);
        assertEq(address(launcher).balance, 0);
    }

    function _parameters(bytes32 creatorSalt)
        private
        view
        returns (LiquidityGrowthFullRangeLaunchV3.LaunchParameters memory parameters)
    {
        parameters = LiquidityGrowthFullRangeLaunchV3.LaunchParameters({
            name: "Deep Launch",
            symbol: "DEEP",
            metadata: UERC20Metadata({
                description: "A Deep launch test",
                website: "https://programmable.family",
                image: "ipfs://deep",
                extraData: abi.encode("https://x.com/0xprogrammable")
            }),
            creatorSalt: creatorSalt,
            minimumInitialTokenOut: 1,
            initialBuySqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(
                Policy.INITIAL_TICK - Policy.MAX_ABS_OBSERVATION_TICK_DELTA
            ),
            deadline: block.timestamp + 1 hours
        });
    }

    function _deployHook() private returns (LiquidityGrowthFeeOracleHookV2 deployed) {
        bytes memory constructorArgs =
            abi.encode(manager, treasury, vaultFactory, positionManager, Policy.MAX_ABS_OBSERVATION_TICK_DELTA);
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV2).creationCode,
            constructorArgs
        );
        deployed = hookFactory.deploy(
            salt,
            manager,
            treasury,
            ILiquidityGrowthFullRangeVaultFactoryV3(address(vaultFactory)),
            positionManager,
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
    }
}
