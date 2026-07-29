// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthFullRangeAutomationV2 } from "../src/LiquidityGrowthFullRangeAutomationV2.sol";
import { LiquidityGrowthFullRangeLaunchV2 } from "../src/LiquidityGrowthFullRangeLaunchV2.sol";
import { LiquidityGrowthFullRangeVaultFactoryV2 } from "../src/LiquidityGrowthFullRangeVaultFactoryV2.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "../src/LiquidityGrowthFullRangeVaultV2.sol";
import { LiquidityGrowthRangeSourceFactoryV1 } from "../src/LiquidityGrowthRangeSourceFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";

/// @notice Deep V2 integration proof against the pinned canonical Ethereum deployments.
/// @dev This is deliberately separate from local mocks: a green run proves compatibility at SNAPSHOT_BLOCK only.
contract LiquidityGrowthFullRangeV2MainnetForkTest is Test {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

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
    LiquidityGrowthFullRangeVaultFactoryV2 internal vaultFactory;
    PoolSwapTest internal swapRouter;
    LiquidityGrowthFeeOracleHookV1 internal hook;
    LiquidityGrowthFullRangeLaunchV2 internal launcher;
    LiquidityGrowthFullRangeAutomationV2 internal automation;
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
        swapRouter = new PoolSwapTest(manager);
        splitFactory = new FeeSplitVaultFactoryV1();
        rangeFactory = new LiquidityGrowthRangeSourceFactoryV1();
        forwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        treasury = makeAddr("deepV2ForkTreasury");

        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, treasury, splitFactory, int24(400))
        );
        hook = hookFactory.deploy(hookSalt, manager, treasury, splitFactory, 400);
        vaultFactory = new LiquidityGrowthFullRangeVaultFactoryV2(
            hookFactory, splitFactory, positionManager, forwarderFactory, rangeFactory
        );
        launcher = new LiquidityGrowthFullRangeLaunchV2(
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
        creator = makeAddr("deepV2ForkCreator");
        vm.deal(creator, 10 ether);
        vm.deal(address(this), 10 ether);
    }

    function test_pinnedOfficialDependenciesAndDeterministicV2LaunchProvenance() public {
        assertEq(block.chainid, 1);
        assertEq(block.number, SNAPSHOT_BLOCK);
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_CODE_HASH);
        assertEq(POSITION_MANAGER.codehash, POSITION_MANAGER_CODE_HASH);
        assertEq(UERC20_FACTORY.codehash, UERC20_FACTORY_CODE_HASH);
        assertEq(address(positionManager.poolManager()), POOL_MANAGER);

        (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        ) = _launch(keccak256("deep-v2-fork-provenance"));

        assertEq(address(launcher.poolManager()), POOL_MANAGER);
        assertEq(address(launcher.positionManager()), POSITION_MANAGER);
        assertEq(address(launcher.tokenFactory()), UERC20_FACTORY);
        assertEq(address(launcher.feeHook()), address(hook));
        assertEq(address(launcher.growthVaultFactory()), address(vaultFactory));
        assertEq(address(automation.vaultFactory()), address(vaultFactory));
        assertEq(automation.launcher(), address(launcher));
        assertTrue(automation.isRegisteredVault(address(vault)));

        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(vault.poolId(), result.poolId);
        assertEq(vault.creator(), creator);
        assertEq(vault.configurationHash(), result.vaultConfigurationHash);
        assertEq(vaultFactory.configurationHashOf(address(vault)), result.vaultConfigurationHash);
        assertTrue(vaultFactory.isFactoryVault(address(vault)));
        assertEq(vaultFactory.initializationCommitment(address(vault)), bytes32(0));
        assertEq(launcher.growthVaultOf(result.token), address(vault));
        assertEq(launcher.launchHashOf(result.token), result.launchHash);

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
        assertEq(vault.initialPositionTokenId(), result.positionTokenId);
        assertEq(vault.initialPositionRecipient(), result.positionRecipient);
        assertEq(vault.beneficiaryCount(), 1);
        assertEq(vault.beneficiaryAt(0), creator);
        assertEq(vault.shareBpsOf(creator), 10_000);
        assertEq(vault.payoutAddressOf(creator), creator);

        (PoolKey memory positionKey, PositionInfo positionInfo) =
            positionManager.getPoolAndPositionInfo(result.positionTokenId);
        assertEq(PoolId.unwrap(positionKey.toId()), result.poolId);
        assertEq(address(positionKey.hooks), address(hook));
        assertEq(positionInfo.tickLower(), TickMath.minUsableTick(launcher.TICK_SPACING()));
        assertEq(positionInfo.tickUpper(), launcher.INITIAL_TICK());

        (address rewardVault, address registrar, uint16 buyFee, uint16 sellFee, bool registered,) =
            hook.poolFeeConfig(result.poolId);
        assertTrue(registered);
        assertEq(rewardVault, result.upstreamRewardVault);
        assertEq(registrar, address(launcher));
        assertEq(buyFee, 100);
        assertEq(sellFee, 100);
        assertEq(address(vault.upstreamVault()), rewardVault);
    }

    function test_officialMainnetManagersSupportV2FeesKeeperAndAddOnlyGrowth() public {
        (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        ) = _launch(keccak256("deep-v2-fork-lifecycle"));

        uint256 creatorFeesBefore = _creatorFees(result.poolId);
        uint256 launcherFeesBefore = hook.launcherFeesAccrued();
        (uint256 expectedCreatorFee, uint256 expectedLauncherFee) = hook.quoteGrossFees(1 ether, 100);
        _swap(key, 1 ether);
        assertEq(_creatorFees(result.poolId) - creatorFeesBefore, expectedCreatorFee);
        assertEq(hook.launcherFeesAccrued() - launcherFeesBefore, expectedLauncherFee);

        while (_cardinalityNext(result.poolId) < automation.OBSERVATION_CARDINALITY_TARGET()) {
            (bool performed, LiquidityGrowthFullRangeAutomationV2.Action action) =
                automation.performVault(address(vault));
            assertTrue(performed);
            assertEq(uint8(action), uint8(LiquidityGrowthFullRangeAutomationV2.Action.GrowOracle));
        }

        (bool processed, LiquidityGrowthFullRangeAutomationV2.Action processAction) =
            automation.performVault(address(vault));
        assertTrue(processed);
        assertEq(uint8(processAction), uint8(LiquidityGrowthFullRangeAutomationV2.Action.ProcessFees));
        assertEq(vault.totalCreatorFeesReceived(), creatorFeesBefore + expectedCreatorFee);
        assertEq(vault.pendingGrowthNative(), creatorFeesBefore + expectedCreatorFee);
        assertEq(hook.launcherFeesAccrued() - launcherFeesBefore, expectedLauncherFee);

        _matureOracle(key);
        uint256 initialPositionTokenId = vault.initialPositionTokenId();
        address initialPositionOwner = IERC721(POSITION_MANAGER).ownerOf(initialPositionTokenId);
        (bool compounded, LiquidityGrowthFullRangeAutomationV2.Action compoundAction) =
            automation.performVault(address(vault));
        assertTrue(compounded);
        assertEq(uint8(compoundAction), uint8(LiquidityGrowthFullRangeAutomationV2.Action.CompoundPending));
        assertGt(vault.totalNativeAddedToLiquidity(), 0);
        assertGt(vault.totalTokenAddedToLiquidity(), 0);
        assertGt(vault.lockedLiquidity(), 0);
        assertEq(vault.lockedLiquidity(), vault.totalLiquidityAdded());
        assertEq(_managerLockedLiquidity(result.poolId, vault), vault.lockedLiquidity());
        assertEq(IERC721(POSITION_MANAGER).ownerOf(initialPositionTokenId), initialPositionOwner);
        assertEq(manager.currencyDelta(address(vault), key.currency0), 0);
        assertEq(manager.currencyDelta(address(vault), key.currency1), 0);

        uint128 firstLockedLiquidity = vault.lockedLiquidity();
        _swap(key, 0.25 ether);
        (processed, processAction) = automation.performVault(address(vault));
        assertTrue(processed);
        assertEq(uint8(processAction), uint8(LiquidityGrowthFullRangeAutomationV2.Action.ProcessFees));
        _matureOracle(key);
        (compounded, compoundAction) = automation.performVault(address(vault));
        assertTrue(compounded);
        assertEq(uint8(compoundAction), uint8(LiquidityGrowthFullRangeAutomationV2.Action.CompoundPending));
        assertGt(vault.lockedLiquidity(), firstLockedLiquidity);
        assertEq(vault.lockedLiquidity(), vault.totalLiquidityAdded());
        assertEq(_managerLockedLiquidity(result.poolId, vault), vault.lockedLiquidity());
        assertEq(IERC721(POSITION_MANAGER).ownerOf(initialPositionTokenId), initialPositionOwner);
    }

    function test_officialForkKeeperBatchIsFailureIsolatedAndIdleRunsConsumeNothing() public {
        (, PoolKey memory key, LiquidityGrowthFullRangeVaultV2 vault) =
            _launch(keccak256("deep-v2-fork-keeper-isolation"));
        _swap(key, 0.25 ether);

        address[] memory candidates = new address[](3);
        candidates[0] = address(0xbeef);
        candidates[1] = address(vault);
        candidates[2] = address(0);
        (uint256 attempted, uint256 succeeded) = automation.performBatch(candidates);
        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        assertEq(_cardinalityNext(vault.poolId()), 18);

        uint256 pendingBefore = vault.pendingGrowthNative();
        uint256 receivedBefore = vault.totalCreatorFeesReceived();
        (bool performed, LiquidityGrowthFullRangeAutomationV2.Action action) = automation.performVault(address(vault));
        assertTrue(performed);
        assertEq(uint8(action), uint8(LiquidityGrowthFullRangeAutomationV2.Action.GrowOracle));
        assertEq(vault.pendingGrowthNative(), pendingBefore);
        assertEq(vault.totalCreatorFeesReceived(), receivedBefore);
    }

    function _launch(bytes32 creatorSalt)
        private
        returns (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        )
    {
        LiquidityGrowthFullRangeLaunchV2.LaunchParameters memory parameters =
            LiquidityGrowthFullRangeLaunchV2.LaunchParameters({
                name: "Deep V2 Fork",
                symbol: "D2FORK",
                creatorSalt: creatorSalt,
                metadata: UERC20Metadata({
                    description: "Deep V2 canonical mainnet dependency test",
                    website: "https://programmable.family",
                    image: "ipfs://deep-v2-mainnet-fork",
                    extraData: ""
                })
            });

        uint256 initialBuy = launcher.MIN_INITIAL_BUY_WEI();
        vm.prank(creator);
        result = launcher.launch{ value: initialBuy }(parameters);
        vault = LiquidityGrowthFullRangeVaultV2(payable(result.growthVault));
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(result.token),
            fee: launcher.LP_FEE_PIPS(),
            tickSpacing: launcher.TICK_SPACING(),
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
        for (uint256 write; write < 32; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            _swap(key, 0.000_001 ether);
        }
        vm.warp(block.timestamp + 30 minutes);
        vm.roll(block.number + 150);
    }

    function _managerLockedLiquidity(bytes32 poolId, LiquidityGrowthFullRangeVaultV2 vault)
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

    function _creatorFees(bytes32 poolId) private view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(poolId);
    }

    function _cardinalityNext(bytes32 poolId) private view returns (uint16 cardinalityNext) {
        (,, cardinalityNext) = hook.stateById(PoolId.wrap(poolId));
    }
}
