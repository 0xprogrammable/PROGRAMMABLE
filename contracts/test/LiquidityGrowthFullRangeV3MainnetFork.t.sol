// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { ProtocolFeeLibrary } from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { DeepKeeperExecutorV2 } from "../src/DeepKeeperExecutorV2.sol";
import { LiquidityGrowthFeeOracleHookFactoryV2 } from "../src/LiquidityGrowthFeeOracleHookFactoryV2.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangeAutomationV3 } from "../src/LiquidityGrowthFullRangeAutomationV3.sol";
import { LiquidityGrowthFullRangeLaunchV3 } from "../src/LiquidityGrowthFullRangeLaunchV3.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthFullRangeVaultFactoryV3 } from "../src/LiquidityGrowthFullRangeVaultFactoryV3.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "../src/LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthZapPlannerV3 } from "../src/LiquidityGrowthZapPlannerV3.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { ILiquidityGrowthFullRangeVaultFactoryV3 } from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

/// @notice Deep integration proof against pinned canonical Ethereum deployments.
/// @dev A green run proves compatibility only at SNAPSHOT_BLOCK; it does not broadcast a transaction.
contract LiquidityGrowthFullRangeV3MainnetForkTest is Test {
    using ProtocolFeeLibrary for uint24;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    uint256 internal constant SNAPSHOT_BLOCK = 25_635_400;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address internal constant LOCKED_POSITION_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;

    bytes32 internal constant POOL_MANAGER_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 internal constant POSITION_MANAGER_CODE_HASH =
        0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b;
    bytes32 internal constant UERC20_FACTORY_CODE_HASH =
        0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb;
    bytes32 internal constant LOCKED_POSITION_FACTORY_CODE_HASH =
        0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2;

    IPoolManager internal manager;
    IPositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    PoolSwapTest internal swapRouter;
    LiquidityGrowthZapPlannerV3 internal planner;
    LiquidityGrowthFullRangeVaultFactoryV3 internal vaultFactory;
    LiquidityGrowthFeeOracleHookFactoryV2 internal hookFactory;
    LiquidityGrowthFeeOracleHookV2 internal hook;
    LiquidityGrowthFullRangeLaunchV3 internal launcher;
    LiquidityGrowthFullRangeAutomationV3 internal automation;
    DeepKeeperExecutorV2 internal executor;
    LiquidityGrowthFullRangeLaunchV3.LaunchResult internal launchResult;
    LiquidityGrowthFullRangeVaultV3 internal vault;
    PoolKey internal key;
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
        positionForwarderFactory = LockedPositionFeeForwarderFactoryV1(LOCKED_POSITION_FACTORY);
        swapRouter = new PoolSwapTest(manager);
        planner = new LiquidityGrowthZapPlannerV3();
        vaultFactory = new LiquidityGrowthFullRangeVaultFactoryV3(planner);
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV2();
        treasury = makeAddr("deepV3ForkTreasury");
        hook = _deployHook();
        launcher = new LiquidityGrowthFullRangeLaunchV3(
            manager, positionManager, tokenFactory, hook, vaultFactory, positionForwarderFactory
        );
        automation = launcher.automation();
        executor = new DeepKeeperExecutorV2(automation);

        creator = makeAddr("deepV3ForkCreator");
        vm.deal(creator, 20 ether);
        launchResult = _launch();
        vault = LiquidityGrowthFullRangeVaultV3(payable(launchResult.growthVault));
        key = launcher.poolKey(launchResult.token);
        vm.prank(creator);
        IERC20(launchResult.token).approve(address(swapRouter), type(uint256).max);
    }

    function test_pinnedOfficialDependenciesAndAtomicLaunchProvenance() public view {
        assertEq(block.chainid, 1);
        assertEq(block.number, SNAPSHOT_BLOCK);
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_CODE_HASH);
        assertEq(POSITION_MANAGER.codehash, POSITION_MANAGER_CODE_HASH);
        assertEq(UERC20_FACTORY.codehash, UERC20_FACTORY_CODE_HASH);
        assertEq(LOCKED_POSITION_FACTORY.codehash, LOCKED_POSITION_FACTORY_CODE_HASH);
        assertEq(address(positionManager.poolManager()), POOL_MANAGER);
        assertEq(address(positionForwarderFactory.positionManager()), POSITION_MANAGER);

        assertEq(launchResult.poolId, PoolId.unwrap(key.toId()));
        assertEq(vault.poolId(), launchResult.poolId);
        assertEq(vault.token(), launchResult.token);
        assertEq(address(vault.feeHook()), address(hook));
        assertEq(address(vault.poolManager()), POOL_MANAGER);
        assertEq(address(vault.positionManager()), POSITION_MANAGER);
        assertEq(address(vault.planner()), address(planner));
        assertEq(vault.FACTORY(), address(vaultFactory));
        assertEq(vault.configurationHash(), launchResult.vaultConfigurationHash);
        assertEq(vaultFactory.configurationHashOf(address(vault)), launchResult.vaultConfigurationHash);
        assertTrue(vaultFactory.isFactoryVault(address(vault)));
        assertTrue(automation.isRegisteredVault(address(vault)));
        assertEq(automation.launcher(), address(launcher));
        assertEq(address(executor.automation()), address(automation));
        assertEq(launcher.growthVaultOf(launchResult.token), address(vault));
        assertEq(launcher.launchHashOf(launchResult.token), launchResult.launchHash);

        UERC20 token = UERC20(launchResult.token);
        assertEq(token.creator(), address(launcher));
        assertEq(token.totalSupply(), launcher.TOKEN_SUPPLY());
        assertGt(token.balanceOf(creator), 0);
        assertEq(token.balanceOf(address(vault)), launchResult.initialLockedTokenDust);
        assertEq(vault.initialTokenDust(), launchResult.initialLockedTokenDust);
        assertEq(vault.accountedTokenDust(), launchResult.initialLockedTokenDust);

        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(launchResult.positionRecipient));
        assertEq(IERC721(POSITION_MANAGER).ownerOf(launchResult.positionTokenId), launchResult.positionRecipient);
        assertEq(address(forwarder.positionManager()), POSITION_MANAGER);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), address(vault));

        (address configuredVault, address registrar, uint8 lifecycle, uint256 growthFees) =
            hook.poolFeeConfig(launchResult.poolId);
        (uint256 expectedGrowthFees, uint256 expectedProgrammableFees) =
            hook.quoteGrossFees(launchResult.initialBuyNativeAmount);
        assertEq(configuredVault, address(vault));
        assertEq(registrar, address(launcher));
        assertEq(lifecycle, hook.LIFECYCLE_FINALIZED());
        assertEq(growthFees, expectedGrowthFees);
        assertEq(hook.launcherFeesAccrued(), expectedProgrammableFees);
    }

    function test_officialManagersSupportAllFeeModesAndAtomicSamePoolGrowth() public {
        _assertExactInputBuy();
        _assertExactOutputBuy();
        _assertExactInputSell();
        _assertExactOutputSell();

        uint128 lockedBefore = vault.lockedLiquidity();
        _stageAndMatureOracle();
        (, uint256 programmableBefore) = _feeSnapshot();
        assertEq(
            uint8(automation.checkVault(address(vault))), uint8(LiquidityGrowthFullRangeAutomationV3.Action.Compound)
        );

        DeepKeeperExecutorV2.Candidate[] memory candidates = new DeepKeeperExecutorV2.Candidate[](1);
        candidates[0] = DeepKeeperExecutorV2.Candidate({
            vault: address(vault), expectedAction: LiquidityGrowthFullRangeAutomationV3.Action.Compound
        });
        uint256 gasBefore = gasleft();
        (, uint256 attempted, uint256 succeeded) = executor.execute(candidates);
        uint256 measuredGas = gasBefore - gasleft();
        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        uint256 reviewedCeiling = _eip150(executor.ASSESSMENT_GAS_STIPEND()) + _eip150(executor.COMPOUND_GAS_STIPEND())
            + executor.RESULT_GAS_RESERVE() + executor.FINAL_GAS_RESERVE();
        assertLe(measuredGas * 100, reviewedCeiling * 80);
        emit log_named_uint("Deep V3 Mainnet fork executor compound gas", measuredGas);
        emit log_named_uint("Deep V3 Mainnet fork reviewed per-vault ceiling", reviewedCeiling);
        assertGt(vault.lockedLiquidity(), lockedBefore);
        assertEq(vault.lockedLiquidity(), vault.totalLiquidityAdded());
        assertEq(PoolId.unwrap(vault.poolKey().toId()), launchResult.poolId);

        (uint128 managerLiquidity,,) = manager.getPositionInfo(
            PoolId.wrap(launchResult.poolId),
            address(vault),
            vault.FULL_RANGE_TICK_LOWER(),
            vault.FULL_RANGE_TICK_UPPER(),
            vault.LOCKED_POSITION_SALT()
        );
        assertEq(managerLiquidity, vault.lockedLiquidity());
        assertEq(manager.currencyDelta(address(vault), key.currency0), 0);
        assertEq(manager.currencyDelta(address(vault), key.currency1), 0);
        assertEq(_growthFeesAccrued(), 0);
        assertEq(hook.launcherFeesAccrued(), programmableBefore);
        assertGt(vault.totalNativeSwapped(), 0);
        assertGt(vault.totalNativeAdded(), 0);
        assertGt(vault.totalTokenAdded(), 0);
    }

    function test_directionalProtocolFeeIsIncludedInTheAtomicCompound() public {
        address controller = manager.protocolFeeController();
        assertTrue(controller != address(0));
        vm.prank(controller);
        manager.setProtocolFee(key, 500);
        (,, uint24 packedProtocolFee,) = manager.getSlot0(PoolId.wrap(launchResult.poolId));
        assertEq(packedProtocolFee.getZeroForOneFee(), 500);
        assertEq(packedProtocolFee.getOneForZeroFee(), 0);

        _swap(true, -int256(1 ether), 1 ether);
        _stageAndMatureOracle();
        (, uint256 programmableBefore) = _feeSnapshot();
        DeepKeeperExecutorV2.Candidate[] memory candidates = new DeepKeeperExecutorV2.Candidate[](1);
        candidates[0] = DeepKeeperExecutorV2.Candidate({
            vault: address(vault), expectedAction: LiquidityGrowthFullRangeAutomationV3.Action.Compound
        });
        (, uint256 attempted, uint256 succeeded) = executor.execute(candidates);

        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        assertEq(hook.launcherFeesAccrued(), programmableBefore);
        assertEq(_growthFeesAccrued(), 0);
        assertGt(vault.totalNativeAdded(), 0);
        assertGt(vault.totalTokenAdded(), 0);
    }

    function _launch() private returns (LiquidityGrowthFullRangeLaunchV3.LaunchResult memory result) {
        LiquidityGrowthFullRangeLaunchV3.LaunchParameters memory parameters =
            LiquidityGrowthFullRangeLaunchV3.LaunchParameters({
                name: "Deep V3 Fork",
                symbol: "D3FORK",
                metadata: UERC20Metadata({
                    description: "Deep canonical Ethereum dependency test",
                    website: "https://programmable.family",
                    image: "ipfs://deep-v3-mainnet-fork",
                    extraData: bytes('{"model":"deep"}')
                }),
                creatorSalt: keccak256("deep-v3-mainnet-fork"),
                minimumInitialTokenOut: 1,
                initialBuySqrtPriceLimitX96: launcher.MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96(),
                deadline: block.timestamp + 30 minutes
            });
        vm.prank(creator);
        result = launcher.launch{ value: 0.01 ether }(parameters);
    }

    function _deployHook() private returns (LiquidityGrowthFeeOracleHookV2 deployed) {
        bytes memory constructorArgs = abi.encode(
            manager,
            treasury,
            ILiquidityGrowthFullRangeVaultFactoryV3(address(vaultFactory)),
            positionManager,
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
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

    function _stageAndMatureOracle() private {
        (,, uint16 next) = hook.stateById(PoolId.wrap(launchResult.poolId));
        while (next < automation.OBSERVATION_CARDINALITY_TARGET()) {
            (bool grew,, uint16 stagedNext) = automation.stageOracle(address(vault));
            assertTrue(grew);
            next = stagedNext;
        }
        for (uint256 write; write < 40; ++write) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            _swap(true, -int256(0.000_001 ether), 0.000_001 ether);
        }
        vm.warp(block.timestamp + Policy.TWAP_WINDOW);
        vm.roll(block.number + 150);
        _swap(true, -int256(0.000_001 ether), 0.000_001 ether);
    }

    function _assertExactInputBuy() private {
        (uint256 growthBefore, uint256 programmableBefore) = _feeSnapshot();
        uint256 grossNative = 1 ether;
        BalanceDelta delta = _swap(true, -int256(grossNative), grossNative);
        (uint256 growthAfter, uint256 programmableAfter) = _feeSnapshot();
        assertEq(uint256(-int256(delta.amount0())), grossNative);
        _assertGrossSplit(grossNative, growthAfter - growthBefore, programmableAfter - programmableBefore);
    }

    function _assertExactOutputBuy() private {
        (uint256 growthBefore, uint256 programmableBefore) = _feeSnapshot();
        uint256 tokenOutput = 10_000 ether;
        BalanceDelta delta = _swap(true, int256(tokenOutput), 1 ether);
        (uint256 growthAfter, uint256 programmableAfter) = _feeSnapshot();
        uint256 growth = growthAfter - growthBefore;
        uint256 programmable = programmableAfter - programmableBefore;
        uint256 grossNative = uint256(-int256(delta.amount0()));
        uint256 netNative = grossNative - growth - programmable;
        (uint256 expectedGrowth, uint256 expectedProgrammable) = hook.quoteExactOutputFees(netNative);
        assertEq(uint256(int256(delta.amount1())), tokenOutput);
        assertEq(growth, expectedGrowth);
        assertEq(programmable, expectedProgrammable);
    }

    function _assertExactInputSell() private {
        (uint256 growthBefore, uint256 programmableBefore) = _feeSnapshot();
        uint256 tokenInput = 10_000 ether;
        BalanceDelta delta = _swap(false, -int256(tokenInput), 0);
        (uint256 growthAfter, uint256 programmableAfter) = _feeSnapshot();
        uint256 growth = growthAfter - growthBefore;
        uint256 programmable = programmableAfter - programmableBefore;
        uint256 grossNative = uint256(int256(delta.amount0())) + growth + programmable;
        assertEq(uint256(-int256(delta.amount1())), tokenInput);
        _assertGrossSplit(grossNative, growth, programmable);
    }

    function _assertExactOutputSell() private {
        (uint256 growthBefore, uint256 programmableBefore) = _feeSnapshot();
        uint256 netNative = 0.000_001 ether;
        BalanceDelta delta = _swap(false, int256(netNative), 0);
        (uint256 growthAfter, uint256 programmableAfter) = _feeSnapshot();
        (uint256 expectedGrowth, uint256 expectedProgrammable) = hook.quoteExactOutputFees(netNative);
        assertEq(uint256(int256(delta.amount0())), netNative);
        assertEq(growthAfter - growthBefore, expectedGrowth);
        assertEq(programmableAfter - programmableBefore, expectedProgrammable);
    }

    function _swap(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta delta) {
        vm.prank(creator);
        delta = swapRouter.swap{ value: value }(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function _feeSnapshot() private view returns (uint256 growthAccrued, uint256 programmableAccrued) {
        growthAccrued = _growthFeesAccrued();
        programmableAccrued = hook.launcherFeesAccrued();
    }

    function _growthFeesAccrued() private view returns (uint256 growthAccrued) {
        (,,, growthAccrued) = hook.poolFeeConfig(launchResult.poolId);
    }

    function _assertGrossSplit(uint256 gross, uint256 growth, uint256 programmable) private pure {
        assertEq(growth + programmable, gross * Policy.TOTAL_HOOK_FEE_BPS / Policy.BASIS_POINTS);
        assertEq(programmable, FullMath.mulDiv(gross, Policy.PROGRAMMABLE_FEE_BPS, Policy.BASIS_POINTS));
        assertEq(growth, gross * Policy.TOTAL_HOOK_FEE_BPS / Policy.BASIS_POINTS - programmable);
    }

    function _eip150(uint256 stipend) private pure returns (uint256) {
        return stipend + (stipend + 62) / 63;
    }
}
