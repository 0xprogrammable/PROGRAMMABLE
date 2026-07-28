// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthAutomationV1 } from "../src/LiquidityGrowthAutomationV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthVaultFactoryV1 } from "../src/LiquidityGrowthVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "../src/LiquidityGrowthVaultV1.sol";
import { ILiquidityGrowthOracleV1 } from "../src/interfaces/ILiquidityGrowthOracleV1.sol";

contract LiquidityGrowthAutomationToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_, string memory symbol_) MockERC20("Deep Automation", symbol_, 18) {
        creator = creator_;
    }
}

contract UnauthenticatedAutomationTarget { }

contract LiquidityGrowthAutomationV1Test is Deployers {
    uint16 internal constant TOTAL_SWAP_FEE_BPS = 100;
    uint256 internal constant STANDARD_RESERVE = 10_000 ether;
    int24 internal constant RANGE_HALF_WIDTH = 10_000;
    int24 internal constant MAX_ABS_TICK_DELTA = 5;
    int24 internal constant MAX_SPOT_TWAP_DEVIATION = 400;
    uint32 internal constant TWAP_WINDOW = 30 minutes;
    uint64 internal constant COMPOUND_COOLDOWN = 5 minutes;

    FeeSplitVaultFactoryV1 internal splitFactory;
    LiquidityGrowthVaultFactoryV1 internal growthFactory;
    LiquidityGrowthFeeOracleHookV1 internal hook;
    LiquidityGrowthAutomationV1 internal automation;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    struct Market {
        LiquidityGrowthAutomationToken token;
        LiquidityGrowthVaultV1 vault;
        PoolKey key;
        bytes32 poolId;
    }

    struct MarketDeployment {
        bytes32 salt;
        string symbol;
        uint256 growthTarget;
        uint256 maxCompound;
        uint256 reserveTarget;
        uint256 fundedReserve;
        uint16 cardinalityNext;
        bool matureHistory;
    }

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1_000_000 ether);

        splitFactory = new FeeSplitVaultFactoryV1();
        growthFactory = new LiquidityGrowthVaultFactoryV1();
        LiquidityGrowthFeeOracleHookFactoryV1 hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        address treasury = makeAddr("programmableTreasury");
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, treasury, splitFactory, MAX_ABS_TICK_DELTA)
        );
        hook = hookFactory.deploy(hookSalt, manager, treasury, splitFactory, MAX_ABS_TICK_DELTA);
        automation = new LiquidityGrowthAutomationV1(growthFactory);
    }

    function test_registrationAcceptsOnlyFactoryVaultsAndIsIdempotent() public {
        Market memory market = _deployMarket(
            keccak256("automation-registration"), "REG", 0.009 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        address launchContract = makeAddr("launchContract");

        vm.prank(launchContract);
        assertTrue(automation.registerVault(address(market.vault)));
        assertTrue(automation.isRegisteredVault(address(market.vault)));
        assertEq(automation.registeredVaultCount(), 1);
        assertEq(automation.registeredVaultAt(0), address(market.vault));

        vm.prank(makeAddr("permissionlessRegistrar"));
        assertFalse(automation.registerVault(address(market.vault)));
        assertEq(automation.registeredVaultCount(), 1);

        UnauthenticatedAutomationTarget fake = new UnauthenticatedAutomationTarget();
        vm.expectRevert(abi.encodeWithSelector(LiquidityGrowthAutomationV1.UnrecognizedVault.selector, address(fake)));
        automation.registerVault(address(fake));
    }

    function test_oracleGrowthStartsAtTwoThenAdvancesInBoundedStagesWithoutOvershooting() public {
        Market memory market = _deployMarketWithCardinality(
            keccak256("automation-staged-growth"),
            "STAGE",
            0.009 ether,
            0.009 ether,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            1,
            false
        );
        automation.registerVault(address(market.vault));

        (bool grew, uint16 previous, uint16 next) = automation.stageOracle(address(market.vault));
        assertTrue(grew);
        assertEq(previous, 1);
        assertEq(next, automation.INITIAL_OBSERVATION_CARDINALITY_NEXT());

        uint16 target = automation.OBSERVATION_CARDINALITY_TARGET();
        uint16 step = automation.OBSERVATION_CARDINALITY_STEP();
        for (uint256 stage; next < target; stage++) {
            assertLt(stage, 16);
            (grew, previous, next) = automation.stageOracle(address(market.vault));
            assertTrue(grew);
            assertGt(next, previous);
            assertLe(next - previous, step);
            assertLe(next, target);
        }

        (grew, previous, next) = automation.stageOracle(address(market.vault));
        assertFalse(grew);
        assertEq(previous, target);
        assertEq(next, target);
        (,, uint16 recordedNext) = hook.stateById(PoolId.wrap(market.poolId));
        assertEq(recordedNext, target);
    }

    function test_stagingOneVaultCannotGrowAnotherPool() public {
        Market memory first = _deployMarketWithCardinality(
            keccak256("automation-stage-isolation-one"),
            "ISO1",
            0.009 ether,
            0.009 ether,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            2,
            false
        );
        Market memory second = _deployMarketWithCardinality(
            keccak256("automation-stage-isolation-two"),
            "ISO2",
            0.009 ether,
            0.009 ether,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            2,
            false
        );
        automation.registerVault(address(first.vault));
        automation.registerVault(address(second.vault));

        automation.stageOracle(address(first.vault));

        (,, uint16 firstNext) = hook.stateById(PoolId.wrap(first.poolId));
        (,, uint16 secondNext) = hook.stateById(PoolId.wrap(second.poolId));
        assertEq(firstNext, 2 + automation.OBSERVATION_CARDINALITY_STEP());
        assertEq(secondNext, 2);
    }

    function test_stagedBatchIsolatesInvalidCandidateAndGrowsEveryValidPool() public {
        Market memory first = _deployMarketWithCardinality(
            keccak256("automation-stage-batch-one"),
            "B1",
            0.009 ether,
            0.009 ether,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            2,
            false
        );
        Market memory second = _deployMarketWithCardinality(
            keccak256("automation-stage-batch-two"),
            "B2",
            0.009 ether,
            0.009 ether,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            2,
            false
        );
        automation.registerVault(address(first.vault));
        automation.registerVault(address(second.vault));
        UnauthenticatedAutomationTarget fake = new UnauthenticatedAutomationTarget();
        address[] memory candidates = new address[](3);
        candidates[0] = address(first.vault);
        candidates[1] = address(fake);
        candidates[2] = address(second.vault);

        (uint256 attempted, uint256 succeeded) = automation.stageOracleBatch(candidates);

        assertEq(attempted, 3);
        assertEq(succeeded, 2);
        (,, uint16 firstNext) = hook.stateById(PoolId.wrap(first.poolId));
        (,, uint16 secondNext) = hook.stateById(PoolId.wrap(second.poolId));
        assertEq(firstNext, 2 + automation.OBSERVATION_CARDINALITY_STEP());
        assertEq(secondNext, 2 + automation.OBSERVATION_CARDINALITY_STEP());
    }

    function test_uninitializedRegisteredPoolIsNotScheduledAndCannotBeStaged() public {
        Market memory market = _deployMarketWithCardinality(
            keccak256("automation-uninitialized"),
            "NONE",
            0.009 ether,
            0.009 ether,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            0,
            false
        );
        automation.registerVault(address(market.vault));

        assertEq(
            uint256(automation.checkVault(address(market.vault))), uint256(LiquidityGrowthAutomationV1.Action.None)
        );
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthAutomationV1.OraclePoolNotInitialized.selector, market.poolId)
        );
        automation.stageOracle(address(market.vault));
    }

    function test_compoundingNeedsBothTargetCapacityAndAFullHistoryWindow() public {
        Market memory market = _deployMarketWithCardinality(
            keccak256("automation-capacity-and-history"),
            "GATE",
            0.009 ether,
            0.009 ether,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            1,
            false
        );
        automation.registerVault(address(market.vault));
        _stageToTarget(market.vault);
        _buy(market.key, 1 ether);
        uint256 accrued = _creatorAccrued(market.poolId);
        assertGt(accrued, 0);

        assertEq(
            uint256(automation.checkVault(address(market.vault))), uint256(LiquidityGrowthAutomationV1.Action.None)
        );
        vm.expectRevert();
        market.vault.process();
        assertEq(_creatorAccrued(market.poolId), accrued);
        assertEq(market.vault.totalCreatorFeesReceived(), 0);

        vm.warp(block.timestamp + TWAP_WINDOW);
        assertEq(
            uint256(automation.checkVault(address(market.vault))),
            uint256(LiquidityGrowthAutomationV1.Action.ProcessFees)
        );
        (bool succeeded, LiquidityGrowthAutomationV1.Action action) = automation.performVault(address(market.vault));
        assertTrue(succeeded);
        assertEq(uint256(action), uint256(LiquidityGrowthAutomationV1.Action.ProcessFees));
        assertGt(market.vault.totalNativeAddedToLiquidity(), 0);
    }

    function test_fullHistoryCannotBypassTheTargetCapacityGate() public {
        Market memory market = _deployMarketWithCardinality(
            keccak256("automation-capacity-gate"),
            "CAP",
            0.009 ether,
            0.009 ether,
            STANDARD_RESERVE,
            STANDARD_RESERVE,
            2,
            true
        );
        automation.registerVault(address(market.vault));
        _buy(market.key, 1 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthRangeSourceV1.ObservationCapacityInsufficient.selector,
                uint16(2),
                automation.OBSERVATION_CARDINALITY_TARGET()
            )
        );
        market.vault.process();
        assertEq(
            uint256(automation.checkVault(address(market.vault))),
            uint256(LiquidityGrowthAutomationV1.Action.GrowOracle)
        );

        _stageToTarget(market.vault);
        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory result) = market.vault.process();
        assertGt(received, 0);
        assertGt(result.liquidityAdded, 0);
    }

    function test_assessmentReadsOnlyEachVaultImmutableOriginalPool() public {
        Market memory first = _deployMarket(
            keccak256("automation-pool-one"), "ONE", 0.009 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        Market memory second = _deployMarket(
            keccak256("automation-pool-two"), "TWO", 0.009 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        automation.registerVault(address(first.vault));
        automation.registerVault(address(second.vault));
        assertNotEq(first.poolId, second.poolId);

        _buy(second.key, 1 ether);

        assertEq(uint256(automation.checkVault(address(first.vault))), uint256(LiquidityGrowthAutomationV1.Action.None));
        assertEq(
            uint256(automation.checkVault(address(second.vault))),
            uint256(LiquidityGrowthAutomationV1.Action.ProcessFees)
        );
        assertEq(first.vault.poolId(), first.poolId);
        assertEq(second.vault.poolId(), second.poolId);
        assertEq(first.vault.rangeSource().poolId(), first.poolId);
        assertEq(second.vault.rangeSource().poolId(), second.poolId);
        assertEq(_creatorAccrued(first.poolId), 0);
        assertGt(_creatorAccrued(second.poolId), 0);
    }

    function test_permissionlessBatchProcessesReadyVaultAndSkipsEveryNotReadyCandidate() public {
        Market memory idle = _deployMarket(
            keccak256("automation-idle"), "IDLE", 0.009 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        Market memory underfunded = _deployMarket(
            keccak256("automation-underfunded"),
            "UNDER",
            0.009 ether,
            0.009 ether,
            STANDARD_RESERVE,
            STANDARD_RESERVE - 1
        );
        Market memory ready = _deployMarket(
            keccak256("automation-ready"), "READY", 0.009 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        automation.registerVault(address(idle.vault));
        automation.registerVault(address(underfunded.vault));
        automation.registerVault(address(ready.vault));
        UnauthenticatedAutomationTarget fake = new UnauthenticatedAutomationTarget();

        _buy(underfunded.key, 1 ether);
        _buy(ready.key, 1 ether);
        address[] memory candidates = new address[](4);
        candidates[0] = address(idle.vault);
        candidates[1] = address(fake);
        candidates[2] = address(underfunded.vault);
        candidates[3] = address(ready.vault);

        LiquidityGrowthAutomationV1.Work[] memory work = automation.checkBatch(candidates);
        assertEq(work.length, 1);
        assertEq(work[0].vault, address(ready.vault));
        assertEq(uint256(work[0].action), uint256(LiquidityGrowthAutomationV1.Action.ProcessFees));

        address keeper = makeAddr("keeper");
        vm.prank(keeper);
        (uint256 attempted, uint256 succeeded) = automation.performBatch(candidates);
        assertEq(attempted, 1);
        assertEq(succeeded, 1);
        assertGt(ready.vault.totalCreatorFeesReceived(), 0);
        assertEq(_creatorAccrued(ready.poolId), 0);
        assertGt(_creatorAccrued(underfunded.poolId), 0);
        assertEq(underfunded.vault.totalCreatorFeesReceived(), 0);
        assertEq(address(automation).balance, 0);
        assertEq(ready.token.balanceOf(address(automation)), 0);
    }

    function test_processHasPriorityThenPendingGrowthRunsAtFiveMinuteBoundary() public {
        Market memory market = _deployMarket(
            keccak256("automation-cooldown"), "FIVE", 0.018 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        automation.registerVault(address(market.vault));

        _buy(market.key, 1 ether);
        assertEq(
            uint256(automation.checkVault(address(market.vault))),
            uint256(LiquidityGrowthAutomationV1.Action.ProcessFees)
        );
        (bool firstSucceeded, LiquidityGrowthAutomationV1.Action firstAction) =
            automation.performVault(address(market.vault));
        assertTrue(firstSucceeded);
        assertEq(uint256(firstAction), uint256(LiquidityGrowthAutomationV1.Action.ProcessFees));
        uint256 firstLiquidity = market.vault.totalNativeAddedToLiquidity();
        uint256 firstCompoundTimestamp = market.vault.lastCompoundTimestamp();

        _buy(market.key, 1 ether);
        assertEq(
            uint256(automation.checkVault(address(market.vault))),
            uint256(LiquidityGrowthAutomationV1.Action.ProcessFees)
        );
        (bool secondSucceeded,) = automation.performVault(address(market.vault));
        assertTrue(secondSucceeded);
        assertGt(market.vault.pendingGrowthNative(), 0);
        assertEq(market.vault.lastCompoundTimestamp(), firstCompoundTimestamp);
        assertEq(
            uint256(automation.checkVault(address(market.vault))), uint256(LiquidityGrowthAutomationV1.Action.None)
        );

        vm.warp(firstCompoundTimestamp + COMPOUND_COOLDOWN - 1);
        assertEq(
            uint256(automation.checkVault(address(market.vault))), uint256(LiquidityGrowthAutomationV1.Action.None)
        );
        vm.warp(firstCompoundTimestamp + COMPOUND_COOLDOWN);
        assertEq(
            uint256(automation.checkVault(address(market.vault))),
            uint256(LiquidityGrowthAutomationV1.Action.CompoundPending)
        );

        vm.prank(makeAddr("fallbackExecutor"));
        (bool compoundSucceeded, LiquidityGrowthAutomationV1.Action compoundAction) =
            automation.performVault(address(market.vault));
        assertTrue(compoundSucceeded);
        assertEq(uint256(compoundAction), uint256(LiquidityGrowthAutomationV1.Action.CompoundPending));
        assertGt(market.vault.totalNativeAddedToLiquidity(), firstLiquidity);
        assertEq(market.vault.lastCompoundTimestamp(), firstCompoundTimestamp + COMPOUND_COOLDOWN);
    }

    function test_completedVaultDoesNotRescheduleBoundedPendingDust() public {
        uint256 nearTargetReserve = 8_954_600_000_000_000;
        Market memory market = _deployMarket(
            keccak256("automation-completion-dust"),
            "DONE",
            0.009 ether,
            0.009 ether,
            nearTargetReserve,
            nearTargetReserve
        );
        automation.registerVault(address(market.vault));

        _buy(market.key, 1 ether);
        (bool succeeded,) = automation.performVault(address(market.vault));
        assertTrue(succeeded);
        assertTrue(market.vault.growthTargetReached());
        assertGt(market.vault.pendingGrowthNative(), 0);

        vm.warp(block.timestamp + COMPOUND_COOLDOWN);
        assertEq(
            uint256(automation.checkVault(address(market.vault))), uint256(LiquidityGrowthAutomationV1.Action.None)
        );
    }

    function test_oneExecutionFailureDoesNotRevertTheRestOfTheBatch() public {
        Market memory cannotCompound =
            _deployMarket(keccak256("automation-zero-liquidity"), "FAIL", 0.009 ether, 0.009 ether, 1, 1);
        Market memory ready = _deployMarket(
            keccak256("automation-after-failure"), "PASS", 0.009 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        automation.registerVault(address(cannotCompound.vault));
        automation.registerVault(address(ready.vault));
        _buy(cannotCompound.key, 1 ether);
        _buy(ready.key, 1 ether);
        vm.mockCall(
            address(cannotCompound.token),
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)"))),
            abi.encode(false)
        );
        assertEq(
            uint256(automation.checkVault(address(cannotCompound.vault))),
            uint256(LiquidityGrowthAutomationV1.Action.ProcessFees)
        );

        address[] memory candidates = new address[](2);
        candidates[0] = address(cannotCompound.vault);
        candidates[1] = address(ready.vault);
        (uint256 attempted, uint256 succeeded) = automation.performBatch(candidates);

        assertEq(attempted, 2);
        assertEq(succeeded, 1);
        assertEq(cannotCompound.vault.totalCreatorFeesReceived(), 0);
        assertGt(_creatorAccrued(cannotCompound.poolId), 0);
        assertGt(ready.vault.totalCreatorFeesReceived(), 0);
        assertEq(_creatorAccrued(ready.poolId), 0);
    }

    function test_registryScanIsCircularBoundedAndReturnsOnlyReadyWork() public {
        Market memory first = _deployMarket(
            keccak256("automation-scan-one"), "S1", 0.009 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        Market memory second = _deployMarket(
            keccak256("automation-scan-two"), "S2", 0.009 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        Market memory third = _deployMarket(
            keccak256("automation-scan-three"), "S3", 0.009 ether, 0.009 ether, STANDARD_RESERVE, STANDARD_RESERVE
        );
        automation.registerVault(address(first.vault));
        automation.registerVault(address(second.vault));
        automation.registerVault(address(third.vault));
        _buy(second.key, 1 ether);
        _buy(third.key, 1 ether);

        (LiquidityGrowthAutomationV1.Work[] memory firstWindow, uint256 nextCursor) = automation.scan(0, 2);
        assertEq(firstWindow.length, 1);
        assertEq(firstWindow[0].vault, address(second.vault));
        assertEq(nextCursor, 2);

        (LiquidityGrowthAutomationV1.Work[] memory secondWindow, uint256 wrappedCursor) = automation.scan(nextCursor, 2);
        assertEq(secondWindow.length, 1);
        assertEq(secondWindow[0].vault, address(third.vault));
        assertEq(wrappedCursor, 1);

        uint256 maximum = automation.MAX_BATCH_SIZE();
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthAutomationV1.BatchTooLarge.selector, maximum + 1, maximum)
        );
        automation.scan(0, maximum + 1);
    }

    function test_coordinatorRejectsNativeAssetsAndHasNoAdminOrWithdrawalSurface() public {
        (bool nativeAccepted,) = address(automation).call{ value: 1 ether }("");
        assertFalse(nativeAccepted);
        assertEq(address(automation).balance, 0);

        (bool ownerExists,) = address(automation).staticcall(abi.encodeWithSignature("owner()"));
        (bool withdrawExists,) =
            address(automation).call(abi.encodeWithSignature("withdraw(address,uint256)", address(this), 1));
        (bool redirectExists,) =
            address(automation).call(abi.encodeWithSignature("setRecipient(address)", address(this)));
        assertFalse(ownerExists);
        assertFalse(withdrawExists);
        assertFalse(redirectExists);
    }

    function _deployMarket(
        bytes32 salt,
        string memory symbol,
        uint256 growthTarget,
        uint256 maxCompound,
        uint256 reserveTarget,
        uint256 fundedReserve
    ) private returns (Market memory market) {
        return _deployMarketWithCardinality(
            salt,
            symbol,
            growthTarget,
            maxCompound,
            reserveTarget,
            fundedReserve,
            automation.OBSERVATION_CARDINALITY_TARGET(),
            true
        );
    }

    function _deployMarketWithCardinality(
        bytes32 salt,
        string memory symbol,
        uint256 growthTarget,
        uint256 maxCompound,
        uint256 reserveTarget,
        uint256 fundedReserve,
        uint16 cardinalityNext,
        bool matureHistory
    ) private returns (Market memory market) {
        return _deployConfiguredMarket(
            MarketDeployment({
                salt: salt,
                symbol: symbol,
                growthTarget: growthTarget,
                maxCompound: maxCompound,
                reserveTarget: reserveTarget,
                fundedReserve: fundedReserve,
                cardinalityNext: cardinalityNext,
                matureHistory: matureHistory
            })
        );
    }

    function _deployConfiguredMarket(MarketDeployment memory deployment) private returns (Market memory market) {
        market.token = new LiquidityGrowthAutomationToken(address(this), deployment.symbol);
        market.token.mint(address(this), 2_000_000 ether);
        market.token.approve(address(modifyLiquidityRouter), type(uint256).max);
        market.token.approve(address(swapRouter), type(uint256).max);
        market.key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(market.token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        market.poolId = PoolId.unwrap(market.key.toId());

        LiquidityGrowthRangeSourceV1 rangeSource = new LiquidityGrowthRangeSourceV1(
            manager,
            market.key,
            ILiquidityGrowthOracleV1(address(hook)),
            TWAP_WINDOW,
            RANGE_HALF_WIDTH,
            MAX_SPOT_TWAP_DEVIATION
        );
        address beneficiary = makeAddr(string.concat("beneficiary-", deployment.symbol));
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = beneficiary;
        uint16[] memory sharesBps = new uint16[](1);
        sharesBps[0] = 10_000;
        LiquidityGrowthVaultV1.Configuration memory configuration = LiquidityGrowthVaultV1.Configuration({
            poolKey: market.key,
            rangeSource: rangeSource,
            growthTargetNative: deployment.growthTarget,
            maxCompoundNative: deployment.maxCompound,
            tokenReserveTarget: deployment.reserveTarget,
            activeRangeHalfWidthTicks: RANGE_HALF_WIDTH,
            compoundCooldownSeconds: COMPOUND_COOLDOWN,
            beneficiaries: beneficiaries,
            sharesBps: sharesBps
        });
        market.vault = growthFactory.deployOrGet(deployment.salt, hook, splitFactory, configuration);
        assertTrue(market.token.transfer(address(market.vault), deployment.fundedReserve));
        if (deployment.cardinalityNext == 0) {
            hook.registerPool(market.key, address(market.vault.upstreamVault()), TOTAL_SWAP_FEE_BPS, TOTAL_SWAP_FEE_BPS);
            return market;
        }
        _initializeMarketPool(market.vault, market.key, market.poolId, deployment.salt, deployment.cardinalityNext);
        if (deployment.matureHistory) vm.warp(block.timestamp + TWAP_WINDOW);
    }

    function _initializeMarketPool(
        LiquidityGrowthVaultV1 vault,
        PoolKey memory key,
        bytes32 poolId,
        bytes32 salt,
        uint16 cardinalityNext
    ) private {
        hook.registerPool(key, address(vault.upstreamVault()), TOTAL_SWAP_FEE_BPS, TOTAL_SWAP_FEE_BPS);
        manager.initialize(key, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(
            key,
            ModifyLiquidityParams({ tickLower: -20_000, tickUpper: 20_000, liquidityDelta: 1000 ether, salt: salt }),
            ZERO_BYTES
        );
        hook.increaseObservationCardinalityNext(cardinalityNext, PoolId.wrap(poolId));
    }

    function _stageToTarget(LiquidityGrowthVaultV1 vault) private {
        uint16 target = automation.OBSERVATION_CARDINALITY_TARGET();
        for (uint256 stage; stage < 16; stage++) {
            (bool grew,, uint16 next) = automation.stageOracle(address(vault));
            if (!grew) {
                assertEq(next, target);
                return;
            }
            if (next == target) return;
        }
        fail();
    }

    function _buy(PoolKey memory key, uint256 grossNative) private {
        swapRouter.swap{ value: grossNative }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(grossNative), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function _creatorAccrued(bytes32 poolId) private view returns (uint256 creatorFeesAccrued) {
        (,,,,, creatorFeesAccrued) = hook.poolFeeConfig(poolId);
    }
}
