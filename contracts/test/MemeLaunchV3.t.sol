// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PositionInfo, PositionInfoLibrary } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { Vm } from "forge-std/Vm.sol";

import { ClassicCtoAuthorityV1 } from "../src/ClassicCtoAuthorityV1.sol";
import {
    ClassicInitialBuyCustodyConfig,
    ClassicInitialBuyCustodyMode,
    ClassicInitialBuyVestingWalletV1
} from "../src/ClassicInitialBuyVestingWalletV1.sol";
import { ClassicInitialBuyVestingWalletFactoryV1 } from "../src/ClassicInitialBuyVestingWalletFactoryV1.sol";
import { ClassicGraduationVaultFactoryV1 } from "../src/ClassicGraduationVaultFactoryV1.sol";
import { ClassicGraduationVaultV1 } from "../src/ClassicGraduationVaultV1.sol";
import { ClassicLaunchPolicyV1 } from "../src/ClassicLaunchPolicyV1.sol";
import { ClassicPositionPlannerV1 } from "../src/ClassicPositionPlannerV1.sol";
import { ClassicRewardVaultFactoryV1 } from "../src/ClassicRewardVaultFactoryV1.sol";
import { EthCreatorFeeHookFactoryV4 } from "../src/EthCreatorFeeHookFactoryV4.sol";
import { EthCreatorFeeHookV4 } from "../src/EthCreatorFeeHookV4.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV3 } from "../src/MemeLaunchV3.sol";

contract ClassicPlannerImpostor { }

contract MemeLaunchV3Test is Deployers {
    using PositionInfoLibrary for PositionInfo;
    using StateLibrary for IPoolManager;

    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    uint256 private constant EIP_170_RUNTIME_LIMIT = 24_576;
    uint256 private constant EIP_3860_INITCODE_LIMIT = 49_152;
    uint256 private constant LAUNCHER_INTERNAL_RUNTIME_LIMIT = 24_000;
    uint256 private constant LAUNCHER_INTERNAL_INITCODE_LIMIT = 40_000;
    uint256 private constant RANGE_BOUNDARY_MARGIN = 1e12;

    bytes32 private constant TOKEN_LAUNCHED_EVENT = keccak256(
        "MemeTokenLaunchedV2(address,address,bytes32,address,address,address,uint256,uint16,uint16,bytes32,bytes32)"
    );
    bytes32 private constant LIQUIDITY_CONFIGURED_EVENT =
        keccak256("MemeLiquidityConfiguredV2(address,uint256,uint256,uint256,int24,int24,int24,uint24,bytes32)");
    bytes32 private constant INITIAL_BUY_EVENT =
        keccak256("MemeCreatorInitialBuyV2(address,address,bytes32,uint256,uint256,bytes32)");
    bytes32 private constant INITIAL_BUY_CUSTODY_EVENT =
        keccak256("MemeCreatorInitialBuyCustodyV2(address,address,address,uint8,uint16,uint16,bytes32,bytes32)");
    bytes32 private constant BONDING_CONFIGURED_EVENT = keccak256(
        "MemeBondingConfiguredV1(address,bytes32,address,address,uint256,uint256,uint128,uint128,int24,int24,int24,bytes32)"
    );

    PositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    EthCreatorFeeHookFactoryV4 internal hookFactory;
    EthCreatorFeeHookV4 internal feeHook;
    ClassicPositionPlannerV1 internal positionPlanner;
    ClassicCtoAuthorityV1 internal ctoAuthority;
    ClassicRewardVaultFactoryV1 internal vaultFactory;
    ClassicInitialBuyVestingWalletFactoryV1 internal initialBuyVestingWalletFactory;
    ClassicLaunchPolicyV1 internal launchPolicy;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    ClassicGraduationVaultFactoryV1 internal graduationVaultFactory;
    MemeLaunchV3 internal launcher;

    address internal deployer;
    address internal treasury;

    function setUp() public {
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), CANONICAL_POOL_MANAGER);
        manager = IPoolManager(CANONICAL_POOL_MANAGER);
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            CANONICAL_POSITION_MANAGER
        );
        positionManager = PositionManager(payable(CANONICAL_POSITION_MANAGER));
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);

        tokenFactory = new UERC20Factory();
        hookFactory = new EthCreatorFeeHookFactoryV4();
        ctoAuthority = new ClassicCtoAuthorityV1(makeAddr("ctoController"));
        vaultFactory = new ClassicRewardVaultFactoryV1(ctoAuthority);
        initialBuyVestingWalletFactory = new ClassicInitialBuyVestingWalletFactoryV1();
        launchPolicy = new ClassicLaunchPolicyV1();
        positionPlanner = new ClassicPositionPlannerV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        graduationVaultFactory = new ClassicGraduationVaultFactoryV1(positionManager, positionForwarderFactory);
        treasury = makeAddr("programmableTreasury");
        feeHook = _deployHook();
        launcher = new MemeLaunchV3(
            manager,
            positionManager,
            tokenFactory,
            feeHook,
            positionPlanner,
            vaultFactory,
            initialBuyVestingWalletFactory,
            launchPolicy,
            positionForwarderFactory,
            graduationVaultFactory
        );

        deployer = makeAddr("deployer");
        vm.deal(deployer, 30 ether);
    }

    function test_standardPresetPreservesLegacyRangeAndMintsExactlyOneLockedPosition() public {
        uint256 nextTokenIdBefore = positionManager.nextTokenId();
        MemeLaunchV3.LaunchResult memory result = _launch(_parameters(bytes32("standard"), 0), MIN_INITIAL_BUY_WEI);
        (PoolKey memory positionKey, PositionInfo positionInfo) =
            positionManager.getPoolAndPositionInfo(result.positionTokenId);

        assertEq(positionManager.nextTokenId(), nextTokenIdBefore + 1);
        assertEq(result.positionTokenId, nextTokenIdBefore);
        assertEq(PoolId.unwrap(positionKey.toId()), result.poolId);
        assertEq(positionInfo.tickLower(), TickMath.minUsableTick(launcher.TICK_SPACING()));
        assertEq(positionInfo.tickUpper(), launcher.INITIAL_TICK());
        _assertStandardLockedPositionLifecycle(result);
    }

    function test_bondingPresetMintsOneVaultOwnedPositionAndPreservesLegacyEvents() public {
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(bytes32("deep30-events"), 1);
        parameters.initialBuyCustody = ClassicInitialBuyCustodyConfig({
            mode: ClassicInitialBuyCustodyMode.FixedLock, durationDays: 30, cliffDays: 0
        });
        uint256 nextTokenIdBefore = positionManager.nextTokenId();

        vm.recordLogs();
        MemeLaunchV3.LaunchResult memory result = _launch(parameters, MIN_INITIAL_BUY_WEI);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (, PositionInfo positionInfo) = positionManager.getPoolAndPositionInfo(result.positionTokenId);
        ClassicInitialBuyVestingWalletV1 custody = ClassicInitialBuyVestingWalletV1(payable(result.initialBuyCustody));

        assertEq(positionManager.nextTokenId(), nextTokenIdBefore + 1);
        assertEq(result.positionTokenId, nextTokenIdBefore);
        assertEq(positionInfo.tickLower(), positionPlanner.DEEP30_TICK_LOWER());
        assertEq(positionInfo.tickUpper(), launcher.INITIAL_TICK());
        assertEq(IERC20(result.token).balanceOf(deployer), 0);
        assertEq(IERC20(result.token).balanceOf(address(custody)), result.initialBuyTokenAmount);
        assertEq(custody.owner(), deployer);
        assertEq(address(custody.initialBuyToken()), result.token);
        assertEq(_eventCount(logs, TOKEN_LAUNCHED_EVENT), 1);
        assertEq(_eventCount(logs, LIQUIDITY_CONFIGURED_EVENT), 1);
        assertEq(_eventCount(logs, INITIAL_BUY_EVENT), 1);
        assertEq(_eventCount(logs, INITIAL_BUY_CUSTODY_EVENT), 1);
        assertEq(_eventCount(logs, BONDING_CONFIGURED_EVENT), 1);
        _assertBondingLifecycleBeforeGraduation(result);
    }

    function test_bondingPresetAllocates80PercentAndReserves20Percent() public {
        MemeLaunchV3.LaunchResult memory standard =
            _launch(_parameters(bytes32("ratio-standard"), 0), MIN_INITIAL_BUY_WEI);
        MemeLaunchV3.LaunchResult memory bonding =
            _launch(_parameters(bytes32("ratio-bonding"), 1), MIN_INITIAL_BUY_WEI);

        uint256 standardLiquidity = positionManager.getPositionLiquidity(standard.positionTokenId);
        uint256 bondingLiquidity = positionManager.getPositionLiquidity(bonding.positionTokenId);

        assertGt(bondingLiquidity, standardLiquidity);
        assertEq(standard.tokenLiquidityAmount + standard.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertEq(bonding.tokenLiquidityAmount + bonding.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertEq(bonding.graduationReserveAmount, 200_000_000 ether);
        assertEq(
            bonding.tokenLiquidityAmount + bonding.lockedTokenDust - bonding.graduationReserveAmount, 800_000_000 ether
        );
        assertEq(IERC20(bonding.token).balanceOf(bonding.graduationVault), bonding.lockedTokenDust);
    }

    function test_invalidPresetRevertsBeforeTokenVaultPoolOrPositionCreation() public {
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(bytes32("invalid-preset"), 2);
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        uint256 nextTokenIdBefore = positionManager.nextTokenId();

        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(ClassicPositionPlannerV1.InvalidLiquidityPreset.selector, uint8(2)));
        launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);

        assertEq(predictedToken.code.length, 0);
        assertEq(positionManager.nextTokenId(), nextTokenIdBefore);
        assertEq(feeHook.launcherFeesAccrued(), 0);
        assertEq(feeHook.totalNativeFeesAccrued(), 0);
    }

    function test_invalidBuyFeeRevertsBeforeTokenVaultPoolOrPositionCreation() public {
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(keccak256("invalid-buy-fee"), 0);
        parameters.buySwapFeeBps = 11;
        _assertInvalidFeePreflight(parameters, 11);
    }

    function test_invalidSellFeeRevertsBeforeTokenVaultPoolOrPositionCreation() public {
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(keccak256("invalid-sell-fee"), 0);
        parameters.sellSwapFeeBps = 999;
        _assertInvalidFeePreflight(parameters, 999);
    }

    function test_launcherPinsPlannerRuntimeCodehashAndRejectsImpostor() public {
        assertEq(address(launcher.positionPlanner()), address(positionPlanner));
        assertEq(address(positionPlanner).codehash, keccak256(type(ClassicPositionPlannerV1).runtimeCode));

        ClassicPlannerImpostor impostor = new ClassicPlannerImpostor();
        bytes32 actualCodeHash = address(impostor).codehash;
        bytes32 expectedCodeHash = keccak256(type(ClassicPositionPlannerV1).runtimeCode);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeLaunchV3.InvalidPositionPlanner.selector, address(impostor), actualCodeHash, expectedCodeHash
            )
        );
        new MemeLaunchV3(
            manager,
            positionManager,
            tokenFactory,
            feeHook,
            ClassicPositionPlannerV1(address(impostor)),
            vaultFactory,
            initialBuyVestingWalletFactory,
            launchPolicy,
            positionForwarderFactory,
            graduationVaultFactory
        );
    }

    function test_launcherRuntimeAndInitcodeStayBelowReleaseCeilings() public view {
        uint256 runtimeSize = address(launcher).code.length;
        uint256 initcodeSize = vm.getCode("src/MemeLaunchV3.sol:MemeLaunchV3").length;
        assertLt(runtimeSize, EIP_170_RUNTIME_LIMIT);
        assertLt(initcodeSize, EIP_3860_INITCODE_LIMIT);
        assertLt(runtimeSize, LAUNCHER_INTERNAL_RUNTIME_LIMIT);
        assertLt(initcodeSize, LAUNCHER_INTERNAL_INITCODE_LIMIT);
    }

    function test_bondingInitialBuyDirectlyBelowEndpointExecutesInFull() public {
        uint256 capacity = _deep30NetCapacity();
        uint256 targetNet = capacity - RANGE_BOUNDARY_MARGIN;
        uint256 grossInput = _grossForNetTarget(targetNet);

        uint160 sqrtPriceUpperX96 = TickMath.getSqrtPriceAtTick(positionPlanner.INITIAL_TICK());
        uint160 sqrtPriceLowerX96 = TickMath.getSqrtPriceAtTick(positionPlanner.DEEP30_TICK_LOWER());
        uint256 sqrtPriceRatioWad = FullMath.mulDiv(sqrtPriceUpperX96, 1 ether, sqrtPriceLowerX96);
        uint256 tokenPriceMultipleWad = FullMath.mulDiv(sqrtPriceRatioWad, sqrtPriceRatioWad, 1 ether);
        assertEq(capacity, 4_716_512_844_756_726_512);
        assertApproxEqAbs(tokenPriceMultipleWad, 18_913_066_072_547_532_342, 1 gwei);

        MemeLaunchV3.LaunchResult memory result = _launch(_parameters(bytes32("deep30-before-limit"), 1), grossInput);
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(PoolId.wrap(result.poolId));

        assertEq(result.initialBuyNativeAmount, grossInput);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(_netAtMinimumFee(grossInput), targetNet);
        assertEq(capacity - targetNet, RANGE_BOUNDARY_MARGIN);
        assertGt(sqrtPriceX96, TickMath.getSqrtPriceAtTick(positionPlanner.DEEP30_TICK_LOWER()));
        assertEq(address(launcher).balance, 0);
    }

    function test_bondingInitialBuyAtEndpointAutoGraduatesInSamePool() public {
        uint256 capacity = _deep30NetCapacity();
        uint256 grossInput = _grossForNetTarget(capacity);

        MemeLaunchV3.LaunchResult memory result = _launch(_parameters(bytes32("deep30-at-limit"), 1), grossInput);
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(PoolId.wrap(result.poolId));

        assertEq(result.initialBuyNativeAmount, grossInput);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(_netAtMinimumFee(grossInput), capacity);
        assertEq(sqrtPriceX96, TickMath.getSqrtPriceAtTick(positionPlanner.DEEP30_TICK_LOWER()));
        assertEq(address(launcher).balance, 0);
        ClassicGraduationVaultV1 vault = ClassicGraduationVaultV1(payable(result.graduationVault));
        assertTrue(vault.graduated());
        assertEq(result.finalPositionTokenId, vault.finalPositionTokenId());
        assertEq(IERC721(address(positionManager)).ownerOf(result.finalPositionTokenId), result.finalPositionRecipient);
        (PoolKey memory finalKey, PositionInfo finalInfo) =
            positionManager.getPoolAndPositionInfo(result.finalPositionTokenId);
        assertEq(PoolId.unwrap(finalKey.toId()), result.poolId);
        assertEq(finalInfo.tickLower(), positionPlanner.FINAL_TICK_LOWER());
        assertEq(finalInfo.tickUpper(), positionPlanner.FINAL_TICK_UPPER());
        (bool ready, bool completed,) = feeHook.bondingState(result.poolId);
        assertFalse(ready);
        assertTrue(completed);
    }

    function test_externalMaxBuyCanBePermissionlesslyGraduatedAndTradingResumes() public {
        MemeLaunchV3.LaunchResult memory result =
            _launch(_parameters(bytes32("bonding-external-max"), 1), MIN_INITIAL_BUY_WEI);
        PoolKey memory key = launcher.poolKey(result.token);
        (EthCreatorFeeHookV4.BondingState state,, uint256 tokenRemaining, uint256 nativeRemainingNet) =
            feeHook.bondingProgress(result.poolId);
        assertEq(uint8(state), uint8(EthCreatorFeeHookV4.BondingState.Bonding));
        assertGt(tokenRemaining, 0);
        assertGt(nativeRemainingNet, 0);

        uint256 grossRemaining = _grossForNetTarget(nativeRemainingNet);
        vm.deal(address(this), grossRemaining + 1 ether);
        swapRouter.swap{ value: grossRemaining }(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(grossRemaining),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );

        (bool ready, bool completed,) = feeHook.bondingState(result.poolId);
        assertTrue(ready);
        assertFalse(completed);
        vm.expectRevert(
            abi.encodeWithSelector(
                EthCreatorFeeHookV4.UnauthorizedGraduationController.selector, address(this), result.graduationVault
            )
        );
        feeHook.beginGraduation(key);

        address keeper = makeAddr("permissionlessKeeper");
        vm.prank(keeper);
        uint256 finalPositionTokenId = launcher.graduate(result.token);
        assertEq(IERC721(address(positionManager)).ownerOf(finalPositionTokenId), result.finalPositionRecipient);
        (, completed,) = feeHook.bondingState(result.poolId);
        assertTrue(completed);

        swapRouter.swap{ value: 0.001 ether }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.001 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
    }

    function test_vaultMaxBuyConsumesRemainingCurveAndGraduatesAtomically() public {
        MemeLaunchV3.LaunchResult memory result =
            _launch(_parameters(bytes32("bonding-vault-max"), 1), MIN_INITIAL_BUY_WEI);
        ClassicGraduationVaultV1 vault = ClassicGraduationVaultV1(payable(result.graduationVault));
        (uint256 grossNativeAmount, uint256 netNativeAmount) = vault.bondingMaxBuyQuote();
        (,,, uint256 hookNativeRemainingNet) = feeHook.bondingProgress(result.poolId);
        assertEq(netNativeAmount, hookNativeRemainingNet);
        assertEq(_netAtMinimumFee(grossNativeAmount), netNativeAmount);

        address buyer = makeAddr("maxBuyer");
        vm.deal(buyer, grossNativeAmount);
        vm.prank(buyer);
        (uint256 tokenAmount, uint256 finalPositionTokenId) = vault.maxBuyAndGraduate{ value: grossNativeAmount }(buyer);

        assertGt(tokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(buyer), tokenAmount);
        assertTrue(vault.graduated());
        assertEq(vault.finalPositionTokenId(), finalPositionTokenId);
        assertEq(IERC721(address(positionManager)).ownerOf(finalPositionTokenId), result.finalPositionRecipient);
        (bool ready, bool completed,) = feeHook.bondingState(result.poolId);
        assertFalse(ready);
        assertTrue(completed);
    }

    function test_launcherMaxBuyUsesCanonicalVaultAndGraduatesAtomically() public {
        MemeLaunchV3.LaunchResult memory result =
            _launch(_parameters(bytes32("bonding-launcher-max"), 1), MIN_INITIAL_BUY_WEI);
        ClassicGraduationVaultV1 vault = ClassicGraduationVaultV1(payable(result.graduationVault));
        (uint256 grossNativeAmount,) = vault.bondingMaxBuyQuote();

        address buyer = makeAddr("launcherMaxBuyer");
        vm.deal(buyer, grossNativeAmount);
        vm.prank(buyer);
        (uint256 tokenAmount, uint256 finalPositionTokenId) =
            launcher.maxBuyAndGraduate{ value: grossNativeAmount }(result.token, buyer);

        assertGt(tokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(buyer), tokenAmount);
        assertTrue(vault.graduated());
        assertEq(vault.finalPositionTokenId(), finalPositionTokenId);
        assertEq(IERC721(address(positionManager)).ownerOf(finalPositionTokenId), result.finalPositionRecipient);
        (bool ready, bool completed,) = feeHook.bondingState(result.poolId);
        assertFalse(ready);
        assertTrue(completed);
    }

    function test_bondingBlocksThirdPartyLiquidityBeforeGraduation() public {
        MemeLaunchV3.LaunchResult memory result =
            _launch(_parameters(bytes32("bonding-liquidity-lock"), 1), MIN_INITIAL_BUY_WEI);
        PoolKey memory key = launcher.poolKey(result.token);
        ModifyLiquidityParams memory parameters = ModifyLiquidityParams({
            tickLower: positionPlanner.BONDING_TICK_LOWER(),
            tickUpper: positionPlanner.INITIAL_TICK(),
            liquidityDelta: 1,
            salt: bytes32("third-party")
        });

        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        modifyLiquidityRouter.modifyLiquidity(key, parameters, "");
    }

    function test_bondingInitialBuyOverEndpointRevertsAtomicallyWithoutLostEthOrFees() public {
        uint256 capacity = _deep30NetCapacity();
        uint256 targetNet = capacity + 1;
        uint256 grossInput = _grossForNetTarget(targetNet);
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(bytes32("deep30-over-limit"), 1);
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        bytes32 predictedPoolId = PoolId.unwrap(launcher.poolKey(predictedToken).toId());
        uint256 deployerBalanceBefore = deployer.balance;
        uint256 nextTokenIdBefore = positionManager.nextTokenId();
        uint256 launcherFeesBefore = feeHook.launcherFeesAccrued();
        uint256 nativeFeesBefore = feeHook.totalNativeFeesAccrued();

        vm.prank(deployer);
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        launcher.launch{ value: grossInput }(parameters);

        (,,,, bool registered,) = feeHook.poolFeeConfig(predictedPoolId);
        assertEq(_netAtMinimumFee(grossInput), targetNet);
        assertEq(targetNet - capacity, 1);
        assertEq(deployer.balance, deployerBalanceBefore);
        assertEq(predictedToken.code.length, 0);
        assertEq(positionManager.nextTokenId(), nextTokenIdBefore);
        assertFalse(registered);
        assertEq(feeHook.launcherFeesAccrued(), launcherFeesBefore);
        assertEq(feeHook.totalNativeFeesAccrued(), nativeFeesBefore);
        assertEq(address(launcher).balance, 0);
    }

    function _assertStandardLockedPositionLifecycle(MemeLaunchV3.LaunchResult memory result) private {
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertEq(result.poolId, PoolId.unwrap(launcher.poolKey(result.token).toId()));
        assertEq(launcher.launchHashOf(result.token), result.launchHash);
        assertEq(launcher.rewardVaultOf(result.token), result.rewardVault);
        assertEq(IERC20(result.token).totalSupply(), launcher.TOKEN_SUPPLY());
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(address(positionManager)), 0);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(UERC20(result.token).creator(), address(launcher));
        assertGt(positionManager.getPositionLiquidity(result.positionTokenId), 0);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), deployer);
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();
    }

    function _assertBondingLifecycleBeforeGraduation(MemeLaunchV3.LaunchResult memory result) private view {
        ClassicGraduationVaultV1 vault = ClassicGraduationVaultV1(payable(result.graduationVault));
        PositionFeesForwarder finalForwarder = PositionFeesForwarder(payable(result.finalPositionRecipient));
        assertEq(result.poolId, PoolId.unwrap(launcher.poolKey(result.token).toId()));
        assertEq(launcher.graduationVaultOf(result.token), result.graduationVault);
        assertEq(launcher.finalPositionRecipientOf(result.token), result.finalPositionRecipient);
        assertEq(result.positionRecipient, result.graduationVault);
        assertEq(result.graduationReserveAmount, positionPlanner.GRADUATION_TOKEN_RESERVE());
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertEq(IERC20(result.token).balanceOf(result.graduationVault), result.lockedTokenDust);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.graduationVault);
        assertEq(vault.bondingPositionTokenId(), result.positionTokenId);
        assertEq(vault.finalPositionRecipient(), result.finalPositionRecipient);
        assertEq(vault.poolId(), result.poolId);
        assertEq(vault.finalLiquidity(), result.finalLiquidity);
        assertFalse(vault.graduated());
        assertEq(finalForwarder.operator(), address(0));
        assertEq(finalForwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(finalForwarder.feeRecipient(), deployer);
    }

    function _deployHook() private returns (EthCreatorFeeHookV4 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV4).creationCode,
            abi.encode(manager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)))
        );
        deployed = hookFactory.deploy(salt, manager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)));
    }

    function _launch(MemeLaunchV3.LaunchParameters memory parameters, uint256 value)
        private
        returns (MemeLaunchV3.LaunchResult memory result)
    {
        vm.prank(deployer);
        result = launcher.launch{ value: value }(parameters);
    }

    function _assertInvalidFeePreflight(MemeLaunchV3.LaunchParameters memory parameters, uint16 invalidFee) private {
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        uint256 nextTokenIdBefore = positionManager.nextTokenId();
        bytes memory unexpectedDeploymentWork = abi.encodeWithSignature("UnexpectedDeploymentWork()");

        vm.mockCallRevert(
            address(vaultFactory), ClassicRewardVaultFactoryV1.deployOrGet.selector, unexpectedDeploymentWork
        );
        vm.mockCallRevert(
            address(positionForwarderFactory),
            LockedPositionFeeForwarderFactoryV1.deploy.selector,
            unexpectedDeploymentWork
        );
        vm.mockCallRevert(address(tokenFactory), UERC20Factory.createToken.selector, unexpectedDeploymentWork);
        vm.mockCallRevert(
            address(feeHook),
            bytes4(keccak256("registerPool((address,address,uint24,int24,address),address,uint16,uint16)")),
            unexpectedDeploymentWork
        );
        vm.mockCallRevert(address(manager), IPoolManager.initialize.selector, unexpectedDeploymentWork);
        vm.mockCallRevert(
            address(positionManager), PositionManager.modifyLiquidities.selector, unexpectedDeploymentWork
        );

        vm.expectRevert(abi.encodeWithSelector(EthCreatorFeeHookV4.InvalidTotalSwapFee.selector, invalidFee));
        vm.prank(deployer);
        launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);

        assertEq(predictedToken.code.length, 0);
        assertEq(positionManager.nextTokenId(), nextTokenIdBefore);
        assertEq(feeHook.launcherFeesAccrued(), 0);
        assertEq(feeHook.totalNativeFeesAccrued(), 0);
    }

    function _parameters(bytes32 salt, uint8 liquidityPreset)
        private
        view
        returns (MemeLaunchV3.LaunchParameters memory parameters)
    {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = deployer;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        parameters = MemeLaunchV3.LaunchParameters({
            name: string.concat("Classic V4 ", _hexNibble(uint8(uint256(salt) & 0xf))),
            symbol: string.concat("C4", _hexNibble(uint8(uint256(salt) & 0xf))),
            buySwapFeeBps: 10,
            sellSwapFeeBps: 10,
            liquidityPreset: liquidityPreset,
            creatorSalt: salt,
            metadata: UERC20Metadata({
                description: "Classic V4 liquidity preset fixture",
                website: "https://programmable.family",
                image: "ipfs://classic-v4",
                extraData: bytes("")
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares,
            initialBuyCustody: ClassicInitialBuyCustodyConfig({
                mode: ClassicInitialBuyCustodyMode.Unlocked, durationDays: 0, cliffDays: 0
            })
        });
    }

    function _deep30NetCapacity() private view returns (uint256 capacity) {
        PoolKey memory key = launcher.poolKey(address(0xBEEF));
        (, Position memory position,) =
            positionPlanner.buildOneSidedPlan(key, address(0xCAFE), positionPlanner.DEEP30_PRESET());
        capacity = SqrtPriceMath.getAmount0Delta(
            TickMath.getSqrtPriceAtTick(positionPlanner.DEEP30_TICK_LOWER()),
            TickMath.getSqrtPriceAtTick(positionPlanner.INITIAL_TICK()),
            uint128(position.liquidity),
            true
        );
    }

    function _grossForNetTarget(uint256 targetNet) private pure returns (uint256 gross) {
        gross = FullMath.mulDiv(targetNet, 10_000, 9990);
        while (_netAtMinimumFee(gross) < targetNet) ++gross;
        while (gross != 0 && _netAtMinimumFee(gross - 1) >= targetNet) --gross;
        assert(_netAtMinimumFee(gross) == targetNet);
    }

    function _netAtMinimumFee(uint256 gross) private pure returns (uint256) {
        return gross - FullMath.mulDiv(gross, 10, 10_000);
    }

    function _eventCount(Vm.Log[] memory logs, bytes32 signature) private view returns (uint256 count) {
        for (uint256 index; index < logs.length; index++) {
            if (
                logs[index].emitter == address(launcher) && logs[index].topics.length != 0
                    && logs[index].topics[0] == signature
            ) ++count;
        }
    }

    function _hexNibble(uint8 value) private pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory output = new bytes(1);
        output[0] = alphabet[value];
        return string(output);
    }
}
