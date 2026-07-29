// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthCreatorFeeHookFactoryV2 } from "../src/EthCreatorFeeHookFactoryV2.sol";
import { EthCreatorFeeHookV2 } from "../src/EthCreatorFeeHookV2.sol";
import { ProtocolRevenueDeepenerBaseV1, ProtocolRevenueDeepenerV1 } from "../src/ProtocolRevenueDeepenerV1.sol";

contract RevenueTargetToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Programmable Test", "V4T", 18) {
        creator = creator_;
    }
}

contract ProtocolRevenueDeepenerHarness is ProtocolRevenueDeepenerBaseV1 {
    constructor(IPoolManager manager, PoolKey memory key)
        ProtocolRevenueDeepenerBaseV1(block.chainid, manager, key, PoolId.unwrap(key.toId()))
    { }
}

contract ProtocolRevenueDeepenerV1Test is Deployers {
    using StateLibrary for IPoolManager;

    uint16 internal constant TOTAL_SWAP_FEE_BPS = 100;

    EthCreatorFeeHookFactoryV2 internal hookFactory;
    EthCreatorFeeHookV2 internal hook;
    RevenueTargetToken internal targetToken;
    ProtocolRevenueDeepenerHarness internal deepener;
    PoolKey internal targetKey;
    bytes32 internal poolId;
    address internal creatorRecipient;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1000 ether);

        targetToken = new RevenueTargetToken(address(this));
        targetToken.mint(address(this), 1_000_000 ether);
        targetToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        targetToken.approve(address(swapRouter), type(uint256).max);

        creatorRecipient = makeAddr("creatorRecipient");
        hookFactory = new EthCreatorFeeHookFactoryV2();

        address predictedDeepener = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        hook = _deployHook(predictedDeepener);
        targetKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(targetToken)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: IHooks(address(hook))
        });
        poolId = hook.registerPool(targetKey, creatorRecipient, TOTAL_SWAP_FEE_BPS);
        manager.initialize(targetKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 20 ether }(targetKey, LIQUIDITY_PARAMS, ZERO_BYTES);

        deepener = new ProtocolRevenueDeepenerHarness(manager, targetKey);
        assertEq(address(deepener), predictedDeepener);
    }

    function test_configurationIsImmutableAndBoundToOnePool() public view {
        PoolKey memory configured = deepener.poolKey();
        assertEq(address(deepener.poolManager()), address(manager));
        assertEq(deepener.poolId(), poolId);
        assertEq(deepener.token(), address(targetToken));
        assertEq(deepener.targetHook(), address(hook));
        assertEq(Currency.unwrap(configured.currency0), address(0));
        assertEq(Currency.unwrap(configured.currency1), address(targetToken));
        assertEq(configured.fee, 0);
        assertEq(configured.tickSpacing, 200);
        assertEq(address(configured.hooks), address(hook));
        assertEq(deepener.COMPOUND_INTERVAL_SECONDS(), 6 hours);
        assertEq(deepener.MIN_OBSERVATION_AGE_SECONDS(), 30 minutes);
        assertEq(deepener.MAX_OBSERVATION_AGE_SECONDS(), 2 hours);
    }

    function test_pullsProtocolRevenueAndCompoundsMaximumSafeBatch() public {
        _tradeToAccrueProtocolRevenue(0.2 ether);
        uint256 accrued = hook.launcherFeesAccrued();
        assertEq(accrued, 0.0002 ether);

        uint256 pulled = deepener.pullRevenue(address(hook));
        assertEq(pulled, accrued);
        assertEq(address(deepener).balance, accrued);
        assertEq(deepener.totalRevenueReceived(), accrued);
        assertEq(hook.launcherFeesAccrued(), 0);

        deepener.fund{ value: 0.0998 ether }();
        assertEq(address(deepener).balance, 0.1 ether);

        uint128 liquidityBefore = deepener.lockedLiquidity();
        deepener.snapshotPrice();
        vm.warp(block.timestamp + deepener.MIN_OBSERVATION_AGE_SECONDS());

        ProtocolRevenueDeepenerBaseV1.CompoundResult memory result = deepener.compound();

        assertEq(result.budgetNative, deepener.MAX_COMPOUND_NATIVE());
        assertEq(result.swapNative, result.budgetNative / 2);
        assertGt(result.tokenAcquired, 0);
        assertGt(result.nativeAdded, 0);
        assertGt(result.tokenAdded, 0);
        assertGt(result.liquidityAdded, 0);
        assertEq(deepener.lockedLiquidity(), liquidityBefore + result.liquidityAdded);
        assertEq(deepener.totalLiquidityAdded(), result.liquidityAdded);
        assertEq(deepener.totalNativeSwapped(), result.swapNative);
        assertEq(deepener.totalTokenAcquired(), result.tokenAcquired);
        assertEq(deepener.compoundNonce(), 1);
        (, uint64 snapshotTimestamp) = deepener.snapshot();
        assertEq(snapshotTimestamp, 0);

        uint256 expectedNativeBalance = 0.1 ether - result.swapNative - result.nativeAdded;
        assertEq(address(deepener).balance, expectedNativeBalance);
        assertEq(IERC20(address(targetToken)).balanceOf(address(deepener)), result.tokenDust);
    }

    function test_directSourceClaimIsAccountedByPoolManagerReceive() public {
        _tradeToAccrueProtocolRevenue(0.2 ether);
        uint256 accrued = hook.launcherFeesAccrued();
        uint256 receivedBefore = deepener.totalRevenueReceived();

        uint256 claimed = hook.claimLauncherFees();

        assertEq(claimed, accrued);
        assertEq(address(deepener).balance, accrued);
        assertEq(deepener.totalRevenueReceived(), receivedBefore + accrued);
        assertEq(hook.launcherFeesAccrued(), 0);
    }

    function test_forcedNativeDonationCanOnlyBeCompounded() public {
        deepener.fund{ value: 0.01 ether }();
        uint256 accountedRevenue = deepener.totalRevenueReceived();
        vm.deal(address(deepener), 0.02 ether);

        ProtocolRevenueDeepenerBaseV1.CompoundResult memory result = _snapshotAndCompound();

        assertGt(result.liquidityAdded, 0);
        assertEq(deepener.totalRevenueReceived(), accountedRevenue);
        assertEq(deepener.totalNativeSwapped() + deepener.totalNativeAdded() + address(deepener).balance, 0.02 ether);
    }

    function test_donatedTargetTokensCanOnlyBeCompounded() public {
        deepener.fund{ value: 0.01 ether }();
        targetToken.transfer(address(deepener), 1 ether);

        ProtocolRevenueDeepenerBaseV1.CompoundResult memory result = _snapshotAndCompound();

        assertGt(result.tokenAdded, result.tokenAcquired);
        assertEq(
            deepener.totalTokenAdded() + IERC20(address(targetToken)).balanceOf(address(deepener)),
            deepener.totalTokenAcquired() + 1 ether
        );
    }

    function test_compoundCannotRunBeforeObservationMatures() public {
        deepener.fund{ value: 0.01 ether }();
        deepener.snapshotPrice();

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueDeepenerBaseV1.SnapshotNotMature.selector, 0, deepener.MIN_OBSERVATION_AGE_SECONDS()
            )
        );
        deepener.compound();
    }

    function test_compoundCannotRunTwiceInsideSixHours() public {
        deepener.fund{ value: 0.1 ether }();
        _snapshotAndCompound();

        deepener.snapshotPrice();
        vm.warp(block.timestamp + deepener.MIN_OBSERVATION_AGE_SECONDS());
        uint256 nextTimestamp = uint256(deepener.lastCompoundTimestamp()) + deepener.COMPOUND_INTERVAL_SECONDS();
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueDeepenerBaseV1.CompoundCooldown.selector, block.timestamp, nextTimestamp
            )
        );
        deepener.compound();
    }

    function test_compoundFailsClosedAfterLargePriceMove() public {
        deepener.fund{ value: 0.1 ether }();
        ProtocolRevenueDeepenerBaseV1.Snapshot memory recorded = deepener.snapshotPrice();
        _tradeToAccrueProtocolRevenue(5 ether);
        (, int24 spotTick,,) = manager.getSlot0(PoolId.wrap(poolId));
        assertGt(
            uint256(_tickDelta(recorded.tick, spotTick)), uint256(uint24(deepener.MAX_SNAPSHOT_SPOT_DELTA_TICKS()))
        );

        vm.warp(block.timestamp + deepener.MIN_OBSERVATION_AGE_SECONDS());
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueDeepenerBaseV1.SnapshotPriceDivergence.selector,
                recorded.tick,
                spotTick,
                deepener.MAX_SNAPSHOT_SPOT_DELTA_TICKS()
            )
        );
        deepener.compound();
        assertEq(deepener.lockedLiquidity(), 0);
        assertEq(address(deepener).balance, 0.1 ether);
    }

    function test_everySuccessfulCycleOnlyIncreasesLockedLiquidity() public {
        deepener.fund{ value: 0.2 ether }();
        uint128 previous = deepener.lockedLiquidity();

        for (uint256 cycle; cycle < 3; ++cycle) {
            deepener.snapshotPrice();
            vm.warp(block.timestamp + deepener.MIN_OBSERVATION_AGE_SECONDS());
            ProtocolRevenueDeepenerBaseV1.CompoundResult memory result = deepener.compound();
            uint128 current = deepener.lockedLiquidity();
            assertGt(current, previous);
            assertEq(current, previous + result.liquidityAdded);
            previous = current;
            vm.warp(block.timestamp + deepener.COMPOUND_INTERVAL_SECONDS());
        }
    }

    function testFuzz_compoundAccountsForEveryProcessedAsset(uint96 rawFunding) public {
        uint256 funding = bound(uint256(rawFunding), deepener.MIN_COMPOUND_NATIVE(), 0.2 ether);
        deepener.fund{ value: funding }();

        ProtocolRevenueDeepenerBaseV1.CompoundResult memory result = _snapshotAndCompound();
        uint256 expectedBudget = funding > deepener.MAX_COMPOUND_NATIVE() ? deepener.MAX_COMPOUND_NATIVE() : funding;

        assertEq(result.budgetNative, expectedBudget);
        assertEq(result.swapNative + result.nativeAdded + result.nativeDust, result.budgetNative);
        assertEq(result.tokenAdded + result.tokenDust, result.tokenAcquired);
        assertEq(address(deepener).balance, funding - result.swapNative - result.nativeAdded);
        assertEq(IERC20(address(targetToken)).balanceOf(address(deepener)), result.tokenDust);
        assertEq(deepener.lockedLiquidity(), result.liquidityAdded);
    }

    function test_noWithdrawalRescueApprovalOrArbitraryCallSurfaceExists() public {
        deepener.fund{ value: 0.01 ether }();

        (bool withdrawSucceeded,) = address(deepener).call(abi.encodeWithSignature("withdraw()"));
        (bool rescueSucceeded,) =
            address(deepener).call(abi.encodeWithSignature("rescue(address)", address(targetToken)));
        (bool approveSucceeded,) =
            address(deepener).call(abi.encodeWithSignature("approve(address,uint256)", address(this), 1));
        (bool executeSucceeded,) =
            address(deepener).call(abi.encodeWithSignature("execute(address,bytes)", address(this), bytes("")));

        assertFalse(withdrawSucceeded);
        assertFalse(rescueSucceeded);
        assertFalse(approveSucceeded);
        assertFalse(executeSucceeded);
        assertEq(address(deepener).balance, 0.01 ether);
    }

    function test_rejectsDirectNativeTransferOutsideExplicitFunding() public {
        (bool succeeded, bytes memory reason) = address(deepener).call{ value: 0.01 ether }("");
        assertFalse(succeeded);
        assertEq(bytes4(reason), ProtocolRevenueDeepenerBaseV1.UnauthorizedNativeSender.selector);
    }

    function test_rejectsUnknownRevenueSource() public {
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueDeepenerBaseV1.InvalidSource.selector, address(targetToken))
        );
        deepener.pullRevenue(address(targetToken));
    }

    function test_officialContractBindsToEthereumMainnet() public {
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueDeepenerBaseV1.WrongChain.selector, uint256(1), block.chainid)
        );
        new ProtocolRevenueDeepenerV1();
    }

    function testFork_compoundsTheCanonicalProgrammablePool() public {
        string memory rpcUrl = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;

        vm.createSelectFork(rpcUrl);
        ProtocolRevenueDeepenerV1 official = new ProtocolRevenueDeepenerV1();
        vm.deal(address(this), 1 ether);
        official.fund{ value: 0.01 ether }();

        uint128 liquidityBefore = official.lockedLiquidity();
        official.snapshotPrice();
        vm.warp(block.timestamp + official.MIN_OBSERVATION_AGE_SECONDS());
        ProtocolRevenueDeepenerBaseV1.CompoundResult memory result = official.compound();

        assertGt(result.budgetNative, 0);
        assertGt(result.liquidityAdded, 0);
        assertEq(official.lockedLiquidity(), liquidityBefore + result.liquidityAdded);
        assertEq(official.poolId(), official.PROGRAMMABLE_POOL_ID());
        assertEq(official.token(), official.PROGRAMMABLE_TOKEN());
        assertEq(official.targetHook(), official.PROGRAMMABLE_POOL_HOOK());
    }

    function _snapshotAndCompound() private returns (ProtocolRevenueDeepenerBaseV1.CompoundResult memory result) {
        deepener.snapshotPrice();
        vm.warp(block.timestamp + deepener.MIN_OBSERVATION_AGE_SECONDS());
        result = deepener.compound();
    }

    function _tradeToAccrueProtocolRevenue(uint256 grossInput) private {
        swapRouter.swap{ value: grossInput }(
            targetKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(grossInput), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ZERO_BYTES
        );
    }

    function _deployHook(address launcherTreasury) private returns (EthCreatorFeeHookV2 deployed) {
        uint160 requiredFlags = hookFactory.REQUIRED_HOOK_FLAGS();
        (address predicted, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            requiredFlags,
            type(EthCreatorFeeHookV2).creationCode,
            abi.encode(manager, launcherTreasury)
        );
        deployed = hookFactory.deploy(salt, manager, launcherTreasury);
        assertEq(address(deployed), predicted);
    }

    function _tickDelta(int24 first, int24 second) private pure returns (uint24) {
        int256 difference = int256(first) - int256(second);
        return uint24(uint256(difference < 0 ? -difference : difference));
    }
}
