// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthFullRangeAutomationV1 } from "../src/LiquidityGrowthFullRangeAutomationV1.sol";
import { LiquidityGrowthFullRangeLaunchV1 } from "../src/LiquidityGrowthFullRangeLaunchV1.sol";
import { LiquidityGrowthFullRangeVaultFactoryV1 } from "../src/LiquidityGrowthFullRangeVaultFactoryV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "../src/LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthRangeSourceFactoryV1 } from "../src/LiquidityGrowthRangeSourceFactoryV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";

contract LiquidityGrowthFullRangeMainnetForkTest is Test {
    using StateLibrary for IPoolManager;

    uint256 internal constant SNAPSHOT_BLOCK = 25_612_664;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;

    bytes32 internal constant POOL_MANAGER_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 internal constant POSITION_MANAGER_CODE_HASH =
        0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b;
    bytes32 internal constant UERC20_FACTORY_CODE_HASH =
        0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb;

    IPoolManager internal manager;
    IPositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    FeeSplitVaultFactoryV1 internal splitFactory;
    LiquidityGrowthRangeSourceFactoryV1 internal rangeFactory;
    LockedPositionFeeForwarderFactoryV1 internal forwarderFactory;
    LiquidityGrowthFeeOracleHookFactoryV1 internal hookFactory;
    LiquidityGrowthFullRangeVaultFactoryV1 internal vaultFactory;
    PoolModifyLiquidityTest internal liquidityRouter;
    PoolSwapTest internal swapRouter;
    LiquidityGrowthFeeOracleHookV1 internal hook;
    LiquidityGrowthFullRangeLaunchV1 internal launcher;
    LiquidityGrowthFullRangeAutomationV1 internal automation;
    address internal treasury;
    address internal creator;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    receive() external payable { }

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        manager = IPoolManager(POOL_MANAGER);
        positionManager = IPositionManager(POSITION_MANAGER);
        tokenFactory = UERC20Factory(UERC20_FACTORY);
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);

        splitFactory = new FeeSplitVaultFactoryV1();
        rangeFactory = new LiquidityGrowthRangeSourceFactoryV1();
        forwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        treasury = makeAddr("forkTreasury");
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, treasury, splitFactory, int24(400))
        );
        hook = hookFactory.deploy(hookSalt, manager, treasury, splitFactory, 400);
        vaultFactory = new LiquidityGrowthFullRangeVaultFactoryV1(
            hookFactory, splitFactory, positionManager, forwarderFactory, rangeFactory
        );
        launcher = new LiquidityGrowthFullRangeLaunchV1(
            manager,
            positionManager,
            tokenFactory,
            ILiquidityGrowthFullRangeOracleHookV1(address(hook)),
            splitFactory,
            rangeFactory,
            vaultFactory,
            forwarderFactory
        );
        automation = launcher.automation();
        creator = makeAddr("fullRangeForkCreator");
        vm.deal(creator, 10 ether);
        vm.deal(address(this), 10 ether);
    }

    function test_pinnedOfficialDependenciesAndDeterministicLaunchProvenance() public {
        _assertPinnedDependencies();

        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        ) = _launch(keccak256("full-range-provenance"));

        _assertLaunchDependencies();
        _assertVaultProvenance(result, key, vault);
        _assertTokenAndPositionProvenance(result, vault);
        _assertOracleAndFeeProvenance(result, vault);
    }

    function _assertPinnedDependencies() private view {
        assertEq(block.chainid, 1);
        assertEq(block.number, SNAPSHOT_BLOCK);
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_CODE_HASH);
        assertEq(POSITION_MANAGER.codehash, POSITION_MANAGER_CODE_HASH);
        assertEq(UERC20_FACTORY.codehash, UERC20_FACTORY_CODE_HASH);
        assertEq(address(positionManager.poolManager()), POOL_MANAGER);
    }

    function _assertLaunchDependencies() private view {
        assertEq(address(launcher.poolManager()), POOL_MANAGER);
        assertEq(address(launcher.positionManager()), POSITION_MANAGER);
        assertEq(address(launcher.tokenFactory()), UERC20_FACTORY);
        assertEq(address(launcher.feeHook()), address(hook));
        assertEq(address(launcher.growthVaultFactory()), address(vaultFactory));
        assertEq(address(launcher.rangeSourceFactory()), address(rangeFactory));
        assertEq(address(launcher.positionForwarderFactory()), address(forwarderFactory));
        assertEq(address(hook.poolManager()), POOL_MANAGER);
        assertEq(hook.launcherFeeRecipient(), treasury);
        assertEq(address(hook.feeSplitVaultFactory()), address(splitFactory));
        assertEq(hook.maxAbsTickDelta(), 400);
        assertEq(uint160(address(hook)) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());
        assertTrue(hookFactory.configurationHashOf(address(hook)) != bytes32(0));
    }

    function _assertVaultProvenance(
        LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
        PoolKey memory key,
        LiquidityGrowthFullRangeVaultV1 vault
    ) private view {
        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(vault.poolId(), result.poolId);
        assertEq(address(vault.feeHook()), address(hook));
        assertEq(address(vault.poolManager()), POOL_MANAGER);
        assertEq(address(vault.positionManager()), POSITION_MANAGER);
        assertEq(vault.configurationHash(), result.vaultConfigurationHash);
        assertEq(vaultFactory.configurationHashOf(address(vault)), result.vaultConfigurationHash);
        assertTrue(vaultFactory.isFactoryVault(address(vault)));
        assertTrue(rangeFactory.configurationHashOf(result.oracleGuard) != bytes32(0));
        assertTrue(forwarderFactory.configurationHashOf(result.positionRecipient) != bytes32(0));
        assertEq(launcher.growthVaultOf(result.token), address(vault));
        assertEq(launcher.launchHashOf(result.token), result.launchHash);
    }

    function _assertTokenAndPositionProvenance(
        LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
        LiquidityGrowthFullRangeVaultV1 vault
    ) private view {
        UERC20 token = UERC20(result.token);
        assertEq(token.creator(), address(launcher));
        assertEq(token.totalSupply(), launcher.TOKEN_SUPPLY());
        assertEq(token.balanceOf(address(vault)), launcher.TOKEN_RESERVE_TARGET());
        assertEq(token.balanceOf(address(launcher)), 0);
        assertEq(token.balanceOf(POSITION_MANAGER), 0);

        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(address(forwarder.positionManager()), POSITION_MANAGER);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        (PoolKey memory positionKey, PositionInfo positionInfo) =
            positionManager.getPoolAndPositionInfo(result.positionTokenId);
        assertEq(PoolId.unwrap(positionKey.toId()), result.poolId);
        assertEq(address(positionKey.hooks), address(hook));
        assertEq(positionInfo.tickLower(), TickMath.minUsableTick(launcher.TICK_SPACING()));
        assertEq(positionInfo.tickUpper(), launcher.INITIAL_TICK());
    }

    function _assertOracleAndFeeProvenance(
        LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
        LiquidityGrowthFullRangeVaultV1 vault
    ) private view {
        LiquidityGrowthRangeSourceV1 guard = LiquidityGrowthRangeSourceV1(result.oracleGuard);
        assertEq(address(guard.poolManager()), POOL_MANAGER);
        assertEq(address(guard.oracleHook()), address(hook));
        assertEq(guard.poolId(), result.poolId);
        (address rewardVault, address registrar, uint16 buyFee, uint16 sellFee, bool registered,) =
            hook.poolFeeConfig(result.poolId);
        assertTrue(registered);
        assertEq(rewardVault, result.upstreamRewardVault);
        assertEq(registrar, address(launcher));
        assertEq(buyFee, 200);
        assertEq(sellFee, 200);
        assertEq(rewardVault, address(vault.upstreamVault()));
        assertTrue(splitFactory.configurationHashOf(rewardVault) != bytes32(0));
    }

    function test_callbacksArePoolManagerOnlyOnOfficialFork() public {
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        ) = _launch(keccak256("full-range-callback-auth"));

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeLaunchV1.UnauthorizedUnlockCallback.selector, address(this))
        );
        launcher.unlockCallback("");

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeVaultV1.UnauthorizedUnlockCallback.selector, address(this))
        );
        vault.unlockCallback("");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(
            address(this),
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.001 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        assertEq(vault.poolId(), result.poolId);
    }

    function test_activationStagingAndEmptyFailedRoundsAreBoundedAndFailureIsolated() public {
        (LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,, LiquidityGrowthFullRangeVaultV1 vault) =
            _launch(keccak256("full-range-activation"));

        assertEq(automation.registeredVaultCount(), 1);
        assertEq(automation.registeredVaultAt(0), address(vault));
        assertEq(_cardinalityNext(result.poolId), 2);
        assertEq(uint8(automation.checkVault(address(vault))), uint8(LiquidityGrowthFullRangeAutomationV1.Action.None));

        address[] memory candidates = new address[](2);
        candidates[0] = address(vault);
        candidates[1] = address(0xbeef);
        (uint256 attempted, uint256 succeeded) = automation.performBatch(candidates);
        assertEq(attempted, 0);
        assertEq(succeeded, 0);

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFullRangeAutomationV1.UnauthorizedLauncher.selector, address(this))
        );
        automation.registerAndStageOracle(address(vault));

        (attempted, succeeded) = automation.stageOracleBatch(candidates);
        assertEq(attempted, 2);
        assertEq(succeeded, 1);
        assertEq(_cardinalityNext(result.poolId), 18);

        uint16 previous = 18;
        while (previous < automation.OBSERVATION_CARDINALITY_TARGET()) {
            (bool grew, uint16 beforeGrowth, uint16 afterGrowth) = automation.stageOracle(address(vault));
            assertTrue(grew);
            assertEq(beforeGrowth, previous);
            assertLe(afterGrowth - beforeGrowth, automation.OBSERVATION_CARDINALITY_STEP());
            assertLe(afterGrowth, automation.OBSERVATION_CARDINALITY_TARGET());
            previous = afterGrowth;
        }
        (bool grewAtTarget, uint16 beforeAtTarget, uint16 afterAtTarget) = automation.stageOracle(address(vault));
        assertFalse(grewAtTarget);
        assertEq(beforeAtTarget, automation.OBSERVATION_CARDINALITY_TARGET());
        assertEq(afterAtTarget, beforeAtTarget);
    }

    function test_feeRoutingPullsOnlyCreatorShareAndEmptyProcessingFailsClosed() public {
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        ) = _launch(keccak256("full-range-fee-routing"));
        (uint256 totalCreatorAccrued, uint256 launcherAccrued) = _seedAndAssertFeeAccrual(result.poolId, key);
        _assertCreatorFeeProcessing(result.poolId, vault, totalCreatorAccrued, launcherAccrued);
        _assertFailureIsolatedOracleGrowth(result.poolId, vault);
    }

    function _seedAndAssertFeeAccrual(bytes32 poolId, PoolKey memory key)
        private
        returns (uint256 totalCreatorAccrued, uint256 launcherAccrued)
    {
        uint256 creatorFeesBefore = _creatorFees(poolId);
        uint256 launcherFeesBefore = hook.launcherFeesAccrued();
        uint256 nativeIn = 0.25 ether;
        (uint256 expectedCreatorFee, uint256 expectedLauncherFee) = hook.quoteGrossFees(nativeIn, 200);

        _swap(key, nativeIn);
        assertEq(_creatorFees(poolId) - creatorFeesBefore, expectedCreatorFee);
        assertEq(hook.launcherFeesAccrued() - launcherFeesBefore, expectedLauncherFee);
        totalCreatorAccrued = _creatorFees(poolId);
        launcherAccrued = hook.launcherFeesAccrued();
    }

    function _assertCreatorFeeProcessing(
        bytes32 poolId,
        LiquidityGrowthFullRangeVaultV1 vault,
        uint256 totalCreatorAccrued,
        uint256 launcherAccrued
    ) private {
        (uint256 received, LiquidityGrowthFullRangeVaultV1.CompoundResult memory waiting) = vault.process();
        assertEq(received, totalCreatorAccrued);
        assertEq(waiting.nativeBudget, 0);
        assertEq(_creatorFees(poolId), 0);
        assertEq(hook.launcherFeesAccrued(), launcherAccrued);
        assertEq(vault.totalCreatorFeesReceived(), received);
        assertEq(vault.totalNativeAllocatedToGrowth(), received);
        assertEq(vault.pendingGrowthNative(), received);
        assertEq(vault.totalNativeAddedToLiquidity(), 0);

        vm.expectRevert(abi.encodeWithSelector(FeeSplitVaultV1.NoFeesToClaim.selector, address(vault)));
        vault.process();
    }

    function _assertFailureIsolatedOracleGrowth(bytes32 poolId, LiquidityGrowthFullRangeVaultV1 vault) private {
        address[] memory candidates = new address[](2);
        candidates[0] = address(vault);
        candidates[1] = address(0xbeef);
        (uint256 attempted, uint256 succeeded) = automation.performBatch(candidates);
        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        assertEq(_cardinalityNext(poolId), 18);
    }

    function test_arbitraryExternalLiquidityCannotIncreaseTrustedDepthOnOfficialPoolManager() public {
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        ) = _launch(keccak256("full-range-untrusted-depth"));

        (uint256 trustedDepthBefore, uint256 capBefore) = vault.trustedDepthAndCap();
        uint128 globalLiquidityBefore = manager.getLiquidity(PoolId.wrap(result.poolId));
        assertEq(vault.lockedLiquidity(), 0);

        _swap(key, 0.01 ether);
        assertGt(IERC20(result.token).balanceOf(address(this)), 0);
        IERC20(result.token).approve(address(liquidityRouter), type(uint256).max);
        bytes32 externalSalt = keccak256("external-untrusted-full-range-liquidity");
        liquidityRouter.modifyLiquidity{ value: 1 ether }(
            key,
            ModifyLiquidityParams({
                tickLower: vault.FULL_RANGE_TICK_LOWER(),
                tickUpper: vault.FULL_RANGE_TICK_UPPER(),
                liquidityDelta: int256(1 ether),
                salt: externalSalt
            }),
            ""
        );

        uint128 globalLiquidityAfter = manager.getLiquidity(PoolId.wrap(result.poolId));
        assertEq(globalLiquidityAfter, globalLiquidityBefore + uint128(1 ether));
        (uint128 externalPositionLiquidity,,) = manager.getPositionInfo(
            PoolId.wrap(result.poolId),
            address(liquidityRouter),
            vault.FULL_RANGE_TICK_LOWER(),
            vault.FULL_RANGE_TICK_UPPER(),
            externalSalt
        );
        assertEq(externalPositionLiquidity, uint128(1 ether));
        (uint256 trustedDepthAfter, uint256 capAfter) = vault.trustedDepthAndCap();
        assertEq(trustedDepthAfter, trustedDepthBefore);
        assertEq(capAfter, capBefore);
        assertEq(vault.lockedLiquidity(), 0);
    }

    function test_officialMainnetManagersSupportAtomicLaunchOracleAndFullRangeCompound() public {
        (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        ) = _launch(keccak256("full-range-mainnet-fork"));
        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertTrue(automation.isRegisteredVault(address(vault)));

        while (_cardinalityNext(result.poolId) < 192) {
            automation.stageOracle(address(vault));
        }
        _swap(key, 0.25 ether);
        (uint256 received, LiquidityGrowthFullRangeVaultV1.CompoundResult memory waiting) = vault.process();
        assertGt(received, 0);
        assertEq(waiting.nativeBudget, 0);

        for (uint256 write; write < 16; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            _swap(key, 0.000_001 ether);
        }
        vm.warp(block.timestamp + 30 minutes);
        vm.roll(block.number + 150);
        LiquidityGrowthFullRangeVaultV1.CompoundResult memory compounded = vault.compoundPending();

        assertGt(compounded.nativeAdded, 0);
        assertGt(compounded.tokenAdded, 0);
        assertGt(compounded.liquidityAdded, 0);
        assertEq(vault.lockedLiquidity(), compounded.liquidityAdded);
        assertEq(_managerLockedLiquidity(result.poolId, vault), compounded.liquidityAdded);
        _assertDynamicRangeUnused(result.poolId, vault);
        _assertSecondCompoundAddsToSamePosition(result.poolId, key, vault);
    }

    function _assertDynamicRangeUnused(bytes32 poolId, LiquidityGrowthFullRangeVaultV1 vault) private view {
        LiquidityGrowthRangeSourceV1.RangeQuote memory dynamicQuote = vault.oracleGuard().quoteRange();
        assertTrue(
            dynamicQuote.tickLower != vault.FULL_RANGE_TICK_LOWER()
                || dynamicQuote.tickUpper != vault.FULL_RANGE_TICK_UPPER()
        );
        (uint128 dynamicRangeLiquidity,,) = manager.getPositionInfo(
            PoolId.wrap(poolId),
            address(vault),
            dynamicQuote.tickLower,
            dynamicQuote.tickUpper,
            vault.LOCKED_POSITION_SALT()
        );
        assertEq(dynamicRangeLiquidity, 0);
    }

    function _assertSecondCompoundAddsToSamePosition(
        bytes32 poolId,
        PoolKey memory key,
        LiquidityGrowthFullRangeVaultV1 vault
    ) private {
        uint128 firstLockedLiquidity = vault.lockedLiquidity();
        _swap(key, 0.25 ether);
        (uint256 secondReceipt, LiquidityGrowthFullRangeVaultV1.CompoundResult memory coolingDown) = vault.process();
        assertGt(secondReceipt, 0);
        assertEq(coolingDown.nativeBudget, 0);
        _matureOracle(key);
        LiquidityGrowthFullRangeVaultV1.CompoundResult memory secondCompound = vault.compoundPending();
        assertGt(secondCompound.liquidityAdded, 0);
        assertEq(vault.lockedLiquidity(), firstLockedLiquidity + secondCompound.liquidityAdded);
        assertEq(_managerLockedLiquidity(poolId, vault), vault.lockedLiquidity());
    }

    function _managerLockedLiquidity(bytes32 poolId, LiquidityGrowthFullRangeVaultV1 vault)
        private
        view
        returns (uint128 managerLiquidity)
    {
        (managerLiquidity,,) = manager.getPositionInfo(
            PoolId.wrap(poolId),
            address(vault),
            vault.FULL_RANGE_TICK_LOWER(),
            vault.FULL_RANGE_TICK_UPPER(),
            vault.LOCKED_POSITION_SALT()
        );
    }

    function _launch(bytes32 salt)
        private
        returns (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        )
    {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        LiquidityGrowthFullRangeLaunchV1.LaunchParameters memory parameters =
            LiquidityGrowthFullRangeLaunchV1.LaunchParameters({
                name: "Full Range Fork",
                symbol: "FULLF",
                buySwapFeeBps: 200,
                sellSwapFeeBps: 200,
                creatorSalt: salt,
                metadata: UERC20Metadata({
                    description: "Full Range V1 mainnet fork",
                    website: "https://programmable.family",
                    image: "ipfs://full-range-fork",
                    extraData: ""
                }),
                rewardBeneficiaries: beneficiaries,
                rewardSharesBps: shares
            });

        vm.prank(creator);
        result = launcher.launch{ value: 0.0006 ether }(parameters);
        vault = LiquidityGrowthFullRangeVaultV1(payable(result.growthVault));
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(result.token),
            fee: 0,
            tickSpacing: 200,
            hooks: hook
        });
    }

    function _swap(PoolKey memory key, uint256 nativeAmount) private {
        swapRouter.swap{ value: nativeAmount }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(nativeAmount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function _matureOracle(PoolKey memory key) private {
        for (uint256 write; write < 16; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            _swap(key, 0.000_001 ether);
        }
        vm.warp(block.timestamp + 30 minutes);
        vm.roll(block.number + 150);
    }

    function _creatorFees(bytes32 poolId) private view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(poolId);
    }

    function _cardinalityNext(bytes32 poolId) private view returns (uint16 cardinalityNext) {
        (,, cardinalityNext) = hook.stateById(PoolId.wrap(poolId));
    }
}
