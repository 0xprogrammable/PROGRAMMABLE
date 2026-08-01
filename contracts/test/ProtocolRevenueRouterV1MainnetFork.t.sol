// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo, PositionInfoLibrary } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { Test } from "forge-std/Test.sol";

import { ProtocolRevenueExecutionEnforcerV1 } from "../src/ProtocolRevenueExecutionEnforcerV1.sol";
import {
    IProtocolRevenueExecutionEnforcerTargetV1,
    ProtocolRevenueMetaMaskExecutorV1
} from "../src/ProtocolRevenueMetaMaskExecutorV1.sol";
import { ProtocolRevenueRouterV1 } from "../src/ProtocolRevenueRouterV1.sol";
import {
    IProtocolRevenueEthFeeHookV1,
    IProtocolRevenueMetaMaskDelegationManagerV1,
    IProtocolRevenueRouterTargetV1,
    ProtocolRevenueCaveat,
    ProtocolRevenueDelegation,
    ProtocolRevenueExecution
} from "../src/interfaces/IProtocolRevenueMetaMaskV1.sol";

contract ProtocolRevenueRouterV1MainnetForkTest is Test {
    using PositionInfoLibrary for PositionInfo;
    using StateLibrary for IPoolManager;

    address internal constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant TREASURY = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant V4_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    address internal constant CLASSIC_V1_HOOK = 0x48bB2672c7fd2a12e7fb5D46c441ccD3726520Cc;
    address internal constant CLASSIC_V2_HOOK = 0x025a386eAa79f6067d29848FD05ccC71bEAb20CC;
    address internal constant CLASSIC_V3_HOOK = 0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC;
    address internal constant DEEP_V1_HOOK = 0x48dC3009eC1d3298BBA31f718A9A29d02fC9B0cC;
    address internal constant CRE_FORWARDER = 0x0b93082D9b3C7C97fAcd250082899BAcf3af3885;
    address internal constant METAMASK_DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    uint64 internal constant ETHEREUM_MAINNET_CHAIN_SELECTOR = 5_009_297_550_715_157_269;
    bytes10 internal constant CRE_WORKFLOW_NAME = 0x32666664393234346538;
    bytes32 internal constant CRE_WORKFLOW_ID = "workflow-id";
    bytes4 internal constant EIP1271_MAGIC_VALUE = 0x1626ba7e;

    ProtocolRevenueRouterV1 internal router;
    ProtocolRevenueExecutionEnforcerV1 internal enforcer;
    ProtocolRevenueMetaMaskExecutorV1 internal executor;
    bytes32 internal revenueAuthorityCodeHash;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        vm.createSelectFork(rpc);
        revenueAuthorityCodeHash = REVENUE_AUTHORITY.codehash;
        router = new ProtocolRevenueRouterV1();
        enforcer = new ProtocolRevenueExecutionEnforcerV1(IProtocolRevenueRouterTargetV1(address(router)));
        executor = new ProtocolRevenueMetaMaskExecutorV1(
            IProtocolRevenueRouterTargetV1(address(router)),
            IProtocolRevenueExecutionEnforcerTargetV1(address(enforcer))
        );
    }

    function test_liveBacklogClaimsAllCurrentNativeSourcesAndExecutesOneAtomicPolicyCycle() public {
        uint256 authorityBalanceBefore = REVENUE_AUTHORITY.balance;
        uint256 accruedBefore = _totalHookFees();
        uint256 pendingBefore = router.pendingNewRevenue();
        uint256 expectedRevenue = authorityBalanceBefore + accruedBefore + pendingBefore;
        assertGt(expectedRevenue, 2 ether);

        uint256 treasuryBefore = TREASURY.balance;
        uint256 positionManagerBalanceBefore = address(router.POSITION_MANAGER()).balance;
        _configureValidDelegation();
        uint64 scheduledAt = uint64(block.timestamp);
        int24 referenceTick = router.currentMainPoolTick();
        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadata(), _cycleReport(scheduledAt, referenceTick));
        int24 tickAfter = router.currentMainPoolTick();
        assertLe(int256(referenceTick) - int256(tickAfter), int256(router.MAX_TOTAL_SWAP_TICK_MOVE()));

        assertEq(REVENUE_AUTHORITY.codehash, revenueAuthorityCodeHash);
        assertEq(REVENUE_AUTHORITY.balance, 0);
        assertEq(router.totalRevenueProcessed(), expectedRevenue);
        assertEq(router.totalTreasurySent(), expectedRevenue / 2);
        assertEq(TREASURY.balance - treasuryBefore, expectedRevenue / 2);
        assertEq(router.totalNativeSwapped(), expectedRevenue / 4);
        assertEq(
            router.totalTreasurySent() + router.totalNativeSwapped() + router.totalNativePrincipalAdded()
                + router.accountedNativeLiquidityDust(),
            expectedRevenue
        );
        assertEq(address(router.POSITION_MANAGER()).balance, positionManagerBalanceBefore);
        assertEq(router.lastProcessedAt(), block.timestamp);
        assertEq(executor.lastAcceptedScheduledAt(), scheduledAt);

        uint256 tokenId = router.positionTokenId();
        assertGt(tokenId, 0);
        assertEq(IERC721(address(router.POSITION_MANAGER())).ownerOf(tokenId), address(router));
        (, PositionInfo info) = router.POSITION_MANAGER().getPoolAndPositionInfo(tokenId);
        assertEq(info.tickLower(), router.FULL_RANGE_TICK_LOWER());
        assertEq(info.tickUpper(), router.FULL_RANGE_TICK_UPPER());
        assertGt(router.POSITION_MANAGER().getPositionLiquidity(tokenId), 0);
        assertGt(router.totalTokenPrincipalAdded(), 0);
    }

    /// forge-config: default.fuzz.runs = 32
    /// forge-config: ci.fuzz.runs = 128
    function testFuzz_firstCycleConservesRevenueAndNeverStrandsEthInPositionManager(uint96 rawRevenue) public {
        uint256 revenue = bound(uint256(rawRevenue), 0.004 ether, 0.4 ether);
        vm.deal(address(router), revenue);
        uint256 treasuryBefore = TREASURY.balance;
        uint256 positionManagerBalanceBefore = address(router.POSITION_MANAGER()).balance;
        int24 referenceTick = router.currentMainPoolTick();

        vm.prank(REVENUE_AUTHORITY);
        router.process(uint64(block.timestamp), referenceTick);

        assertEq(router.totalRevenueProcessed(), revenue);
        assertEq(router.totalTreasurySent(), revenue / 2);
        assertEq(TREASURY.balance - treasuryBefore, revenue / 2);
        assertEq(router.totalNativeSwapped(), revenue / 4);
        assertEq(
            router.totalTreasurySent() + router.totalNativeSwapped() + router.totalNativePrincipalAdded()
                + router.accountedNativeLiquidityDust(),
            revenue
        );
        assertEq(address(router).balance, router.accountedNativeLiquidityDust());
        assertEq(address(router.POSITION_MANAGER()).balance, positionManagerBalanceBefore);
        assertGt(router.totalTokenPrincipalAdded(), 0);
    }

    function test_secondDayReusesPositionAndUsesPriorNativeDustForTheNextBuy() public {
        vm.deal(REVENUE_AUTHORITY, 0.04 ether);
        _configureValidDelegation();
        int24 firstReferenceTick = router.currentMainPoolTick();
        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadata(), _cycleReport(uint64(block.timestamp), firstReferenceTick));

        uint256 tokenId = router.positionTokenId();
        uint128 liquidityBefore = router.POSITION_MANAGER().getPositionLiquidity(tokenId);
        uint256 firstCycleDust = router.accountedNativeLiquidityDust();
        assertGt(firstCycleDust, 0);

        vm.warp(block.timestamp + 1 days);
        vm.deal(REVENUE_AUTHORITY, 0.04 ether);
        uint256 swapBefore = router.totalNativeSwapped();
        int24 secondReferenceTick = router.currentMainPoolTick();
        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadata(), _cycleReport(uint64(block.timestamp), secondReferenceTick));

        assertEq(router.positionTokenId(), tokenId);
        assertGt(router.POSITION_MANAGER().getPositionLiquidity(tokenId), liquidityBefore);
        assertGt(router.totalNativeSwapped() - swapBefore, 0.01 ether);
        assertEq(router.cycleCount(), 2);
    }

    function test_actualWallClockCooldownCannotBeBypassedWithSchedulerTimestamps() public {
        vm.deal(address(router), 0.04 ether);
        int24 referenceTick = router.currentMainPoolTick();
        vm.prank(REVENUE_AUTHORITY);
        router.process(uint64(block.timestamp), referenceTick);

        vm.warp(block.timestamp + 23 hours);
        vm.deal(address(router), address(router).balance + 0.04 ether);
        uint256 eligibleAt = uint256(router.lastProcessedAt()) + router.CYCLE_INTERVAL();
        referenceTick = router.currentMainPoolTick();
        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueRouterV1.CooldownActive.selector, eligibleAt));
        vm.prank(REVENUE_AUTHORITY);
        router.process(uint64(block.timestamp), referenceTick);
    }

    function test_staleOrZeroCycleTimestampIsRejectedBeforeFundsMove() public {
        vm.deal(address(router), 0.04 ether);
        uint256 treasuryBefore = TREASURY.balance;
        uint256 oldestAllowed = block.timestamp - router.MAX_CYCLE_TIMESTAMP_AGE();
        int24 referenceTick = router.currentMainPoolTick();
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueRouterV1.CycleTimestampTooOld.selector, uint64(0), oldestAllowed)
        );
        vm.prank(REVENUE_AUTHORITY);
        router.process(0, referenceTick);
        assertEq(TREASURY.balance, treasuryBefore);
        assertEq(address(router).balance, 0.04 ether);
    }

    function test_futureTimestampAndStaleReferenceFailBeforeFundsMove() public {
        vm.deal(address(router), 0.04 ether);
        uint256 treasuryBefore = TREASURY.balance;
        int24 referenceTick = router.currentMainPoolTick();

        uint64 futureTimestamp = uint64(block.timestamp + router.EXECUTION_DEADLINE() + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueRouterV1.CycleTimestampInFuture.selector,
                futureTimestamp,
                block.timestamp + router.EXECUTION_DEADLINE()
            )
        );
        vm.prank(REVENUE_AUTHORITY);
        router.process(futureTimestamp, referenceTick);

        int24 staleReference = referenceTick + router.MAX_REFERENCE_TICK_DEVIATION() + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueRouterV1.ReferenceTickDeviationTooLarge.selector,
                staleReference,
                referenceTick,
                router.MAX_REFERENCE_TICK_DEVIATION()
            )
        );
        vm.prank(REVENUE_AUTHORITY);
        router.process(uint64(block.timestamp), staleReference);

        assertEq(TREASURY.balance, treasuryBefore);
        assertEq(address(router).balance, 0.04 ether);
    }

    function test_minimumRevenueFailsWithoutMovingFunds() public {
        uint256 belowMinimum = router.MIN_NEW_REVENUE() - 1;
        vm.deal(address(router), belowMinimum);
        int24 referenceTick = router.currentMainPoolTick();
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueRouterV1.InsufficientNewRevenue.selector, belowMinimum, router.MIN_NEW_REVENUE()
            )
        );
        vm.prank(REVENUE_AUTHORITY);
        router.process(uint64(block.timestamp), referenceTick);
        assertEq(address(router).balance, belowMinimum);
    }

    function test_onlyRevenueAuthorityCanProcess() public {
        vm.deal(address(router), 0.04 ether);
        address outsider = makeAddr("outsider");
        int24 referenceTick = router.currentMainPoolTick();
        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueRouterV1.OnlyRevenueAuthority.selector, outsider));
        vm.prank(outsider);
        router.process(uint64(block.timestamp), referenceTick);
    }

    function test_cycleCapacityFailsAtomically() public {
        uint256 excessiveRevenue = router.MAX_NATIVE_SWAP_CHUNK() * router.MAX_SWAP_CHUNKS() * 4 + 4;
        vm.deal(address(router), excessiveRevenue);
        uint256 treasuryBefore = TREASURY.balance;
        int24 referenceTick = router.currentMainPoolTick();
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueRouterV1.SwapAmountExceedsCycleCapacity.selector,
                excessiveRevenue / 4,
                router.MAX_NATIVE_SWAP_CHUNK() * router.MAX_SWAP_CHUNKS()
            )
        );
        vm.prank(REVENUE_AUTHORITY);
        router.process(uint64(block.timestamp), referenceTick);
        assertEq(TREASURY.balance, treasuryBefore);
        assertEq(address(router).balance, excessiveRevenue);
    }

    function test_cumulativePriceImpactBoundFailsAtomically() public {
        uint256 revenue = 5 ether;
        vm.deal(address(router), revenue);
        uint256 treasuryBefore = TREASURY.balance;
        int24 referenceTick = router.currentMainPoolTick();
        vm.expectPartialRevert(ProtocolRevenueRouterV1.SwapTotalTickMoveTooLarge.selector);
        vm.prank(REVENUE_AUTHORITY);
        router.process(uint64(block.timestamp), referenceTick);
        assertEq(TREASURY.balance, treasuryBefore);
        assertEq(address(router).balance, revenue);
        assertEq(router.cycleCount(), 0);
    }

    function test_positionCannotBeTransferredByAnExternalCaller() public {
        vm.deal(address(router), 0.04 ether);
        int24 referenceTick = router.currentMainPoolTick();
        vm.prank(REVENUE_AUTHORITY);
        router.process(uint64(block.timestamp), referenceTick);

        uint256 tokenId = router.positionTokenId();
        address outsider = makeAddr("positionThief");
        IERC721 positionNft = IERC721(address(router.POSITION_MANAGER()));
        vm.expectRevert();
        vm.prank(outsider);
        positionNft.transferFrom(address(router), outsider, tokenId);
        assertEq(positionNft.ownerOf(tokenId), address(router));
    }

    function test_permissionConfigurationRejectsWrongDelegateAndFreezesValidContext() public {
        address outsider = makeAddr("configurationOutsider");
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueMetaMaskExecutorV1.OnlyRevenueAuthority.selector, outsider)
        );
        vm.prank(outsider);
        executor.configureDelegation(bytes(""));

        ProtocolRevenueDelegation[] memory wrong = _delegations(makeAddr("wrongDelegate"));
        vm.expectRevert(ProtocolRevenueMetaMaskExecutorV1.InvalidDelegation.selector);
        vm.prank(REVENUE_AUTHORITY);
        executor.configureDelegation(abi.encode(wrong));

        bytes memory validContext = _configureValidDelegation();
        assertEq(keccak256(executor.permissionContext()), keccak256(validContext));
        assertTrue(executor.delegationHash() != bytes32(0));
        vm.expectRevert(ProtocolRevenueMetaMaskExecutorV1.AlreadyConfigured.selector);
        vm.prank(REVENUE_AUTHORITY);
        executor.configureDelegation(validContext);
    }

    function test_permissionConfigurationRejectsInvalidEip1271Signature() public {
        ProtocolRevenueDelegation[] memory delegations = _delegations(address(executor));
        bytes32 typedDataHash = _delegationTypedDataHash(delegations[0]);
        vm.mockCall(
            REVENUE_AUTHORITY,
            abi.encodeCall(IERC1271.isValidSignature, (typedDataHash, delegations[0].signature)),
            abi.encode(bytes4(0xffffffff))
        );
        vm.expectRevert(ProtocolRevenueMetaMaskExecutorV1.InvalidSignature.selector);
        vm.prank(REVENUE_AUTHORITY);
        executor.configureDelegation(abi.encode(delegations));
    }

    function test_revokedDelegationBlocksTheCycleBeforeAnyFundsMove() public {
        bytes memory permission = _configureValidDelegation();
        ProtocolRevenueDelegation[] memory delegations = abi.decode(permission, (ProtocolRevenueDelegation[]));
        vm.prank(REVENUE_AUTHORITY);
        IProtocolRevenueMetaMaskDelegationManagerV1(METAMASK_DELEGATION_MANAGER).disableDelegation(delegations[0]);

        uint256 treasuryBefore = TREASURY.balance;
        int24 referenceTick = router.currentMainPoolTick();
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueMetaMaskExecutorV1.DelegationDisabled.selector, executor.delegationHash()
            )
        );
        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadata(), _cycleReport(uint64(block.timestamp), referenceTick));
        assertEq(TREASURY.balance, treasuryBefore);
    }

    function test_enforcerRejectsWrongCallerUnsignedArgsAndIncompleteBatch() public {
        bytes memory terms = executor.expectedDelegationTerms();
        bytes32 delegationHash = keccak256("delegation");
        bytes memory processCall = abi.encodeCall(
            IProtocolRevenueRouterTargetV1.process, (uint64(block.timestamp), router.currentMainPoolTick())
        );
        ProtocolRevenueExecution[] memory incomplete = new ProtocolRevenueExecution[](1);
        incomplete[0] = ProtocolRevenueExecution({ target: address(router), value: 0, callData: processCall });
        bytes32 batchMode = enforcer.BATCH_DEFAULT_MODE();

        address outsider = makeAddr("wrongManager");
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueExecutionEnforcerV1.InvalidContext.selector,
                outsider,
                REVENUE_AUTHORITY,
                address(executor)
            )
        );
        vm.prank(outsider);
        enforcer.beforeAllHook(
            terms, bytes(""), batchMode, abi.encode(incomplete), delegationHash, REVENUE_AUTHORITY, address(executor)
        );

        vm.expectRevert(ProtocolRevenueExecutionEnforcerV1.UnsignedArgumentsForbidden.selector);
        vm.prank(METAMASK_DELEGATION_MANAGER);
        enforcer.beforeAllHook(
            terms, hex"01", batchMode, abi.encode(incomplete), delegationHash, REVENUE_AUTHORITY, address(executor)
        );

        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueExecutionEnforcerV1.InvalidExecution.selector, 0));
        vm.prank(METAMASK_DELEGATION_MANAGER);
        enforcer.beforeAllHook(
            terms, bytes(""), batchMode, abi.encode(incomplete), delegationHash, REVENUE_AUTHORITY, address(executor)
        );
    }

    function test_enforcerRejectsEveryAlteredExecutionSurface() public {
        ProtocolRevenueExecution[] memory executions = _mockedCompleteBatch();
        bytes memory terms = executor.expectedDelegationTerms();
        bytes32 mode = enforcer.BATCH_DEFAULT_MODE();
        bytes32 delegationHash = keccak256("delegation");

        executions[0].target = makeAddr("alternateTarget");
        _expectInvalidExecution(terms, mode, delegationHash, executions, 0);

        executions = _mockedCompleteBatch();
        executions[0].value = 1;
        _expectInvalidExecution(terms, mode, delegationHash, executions, 0);

        executions = _mockedCompleteBatch();
        executions[0].callData =
            abi.encodeCall(IProtocolRevenueEthFeeHookV1.claimLauncherFeesTo, (makeAddr("alternateRecipient")));
        _expectInvalidExecution(terms, mode, delegationHash, executions, 0);

        executions = _mockedCompleteBatch();
        ProtocolRevenueExecution memory original = executions[0];
        ProtocolRevenueExecution memory second = executions[1];
        executions[0] = second;
        executions[1] = original;
        _expectInvalidExecution(terms, mode, delegationHash, executions, 0);

        executions = _mockedCompleteBatch();
        uint256 processIndex = executions.length - 1;
        executions[processIndex].callData = abi.encodeWithSelector(bytes4(0xdeadbeef));
        _expectInvalidExecution(terms, mode, delegationHash, executions, type(uint256).max);

        executions = _mockedCompleteBatch();
        processIndex = executions.length - 1;
        ProtocolRevenueExecution[] memory trailing = new ProtocolRevenueExecution[](executions.length + 1);
        for (uint256 i; i < executions.length; ++i) {
            trailing[i] = executions[i];
        }
        trailing[executions.length] =
            ProtocolRevenueExecution({ target: makeAddr("trailingTarget"), value: 0, callData: bytes("") });
        _expectInvalidExecution(terms, mode, delegationHash, trailing, processIndex);

        bytes memory nonCanonical = abi.encodePacked(abi.encode(executions), hex"00");
        vm.expectRevert(ProtocolRevenueExecutionEnforcerV1.NonCanonicalExecutionCalldata.selector);
        vm.prank(METAMASK_DELEGATION_MANAGER);
        enforcer.beforeAllHook(
            terms, bytes(""), mode, nonCanonical, delegationHash, REVENUE_AUTHORITY, address(executor)
        );
    }

    function test_enforcerRejectsAlteredSignedContext() public {
        ProtocolRevenueExecution[] memory executions = _mockedCompleteBatch();
        bytes memory encodedExecutions = abi.encode(executions);
        bytes memory terms = executor.expectedDelegationTerms();
        bytes32 mode = enforcer.BATCH_DEFAULT_MODE();
        bytes32 delegationHash = keccak256("delegation");

        bytes32 wrongMode = bytes32(uint256(1));
        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueExecutionEnforcerV1.InvalidMode.selector, wrongMode));
        vm.prank(METAMASK_DELEGATION_MANAGER);
        enforcer.beforeAllHook(
            terms, bytes(""), wrongMode, encodedExecutions, delegationHash, REVENUE_AUTHORITY, address(executor)
        );

        vm.expectRevert(ProtocolRevenueExecutionEnforcerV1.InvalidDelegationHash.selector);
        vm.prank(METAMASK_DELEGATION_MANAGER);
        enforcer.beforeAllHook(
            terms, bytes(""), mode, encodedExecutions, bytes32(0), REVENUE_AUTHORITY, address(executor)
        );

        bytes memory wrongTerms = abi.encode(address(executor), bytes32(0));
        vm.expectRevert(ProtocolRevenueExecutionEnforcerV1.InvalidTerms.selector);
        vm.prank(METAMASK_DELEGATION_MANAGER);
        enforcer.beforeAllHook(
            wrongTerms, bytes(""), mode, encodedExecutions, delegationHash, REVENUE_AUTHORITY, address(executor)
        );

        address wrongRedeemer = makeAddr("wrongRedeemer");
        vm.expectRevert(ProtocolRevenueExecutionEnforcerV1.InvalidTerms.selector);
        vm.prank(METAMASK_DELEGATION_MANAGER);
        enforcer.beforeAllHook(
            terms, bytes(""), mode, encodedExecutions, delegationHash, REVENUE_AUTHORITY, wrongRedeemer
        );

        address wrongDelegator = makeAddr("wrongDelegator");
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueExecutionEnforcerV1.InvalidContext.selector,
                METAMASK_DELEGATION_MANAGER,
                wrongDelegator,
                address(executor)
            )
        );
        vm.prank(METAMASK_DELEGATION_MANAGER);
        enforcer.beforeAllHook(
            terms, bytes(""), mode, encodedExecutions, delegationHash, wrongDelegator, address(executor)
        );
    }

    function test_creRejectsWrongForwarderChainReplayAndStaleReport() public {
        _configureValidDelegation();
        uint64 scheduledAt = uint64(block.timestamp);
        int24 referenceTick = router.currentMainPoolTick();
        address outsider = makeAddr("reporter");
        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueMetaMaskExecutorV1.OnlyCREForwarder.selector, outsider));
        vm.prank(outsider);
        executor.onReport(_creMetadata(), _cycleReport(scheduledAt, referenceTick));

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueMetaMaskExecutorV1.UnexpectedChainSelector.selector,
                uint64(1),
                ETHEREUM_MAINNET_CHAIN_SELECTOR
            )
        );
        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadata(), abi.encode(uint64(1), scheduledAt, referenceTick));

        uint64 staleScheduledAt = uint64(block.timestamp - executor.MAX_REPORT_AGE() - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueMetaMaskExecutorV1.StaleReport.selector,
                staleScheduledAt,
                block.timestamp - executor.MAX_REPORT_AGE()
            )
        );
        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadata(), _cycleReport(staleScheduledAt, referenceTick));

        uint64 futureScheduledAt = uint64(block.timestamp + executor.MAX_REPORT_FUTURE_SKEW() + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueMetaMaskExecutorV1.FutureReport.selector,
                futureScheduledAt,
                block.timestamp + executor.MAX_REPORT_FUTURE_SKEW()
            )
        );
        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadata(), _cycleReport(futureScheduledAt, referenceTick));

        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueMetaMaskExecutorV1.InvalidMetadataLength.selector, 63));
        vm.prank(CRE_FORWARDER);
        executor.onReport(abi.encodePacked(_creMetadata(), bytes1(0)), _cycleReport(scheduledAt, referenceTick));

        // The literal is exactly ten bytes, so this fixed-bytes cast cannot truncate it.
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes10 wrongWorkflowName = bytes10("wrong-name");
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueMetaMaskExecutorV1.UnexpectedWorkflow.selector, wrongWorkflowName, TREASURY
            )
        );
        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadataFor(wrongWorkflowName, TREASURY), _cycleReport(scheduledAt, referenceTick));

        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadata(), _cycleReport(scheduledAt, referenceTick));
        vm.warp(block.timestamp + 1 days);
        referenceTick = router.currentMainPoolTick();
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueMetaMaskExecutorV1.ReportReplay.selector, scheduledAt, scheduledAt)
        );
        vm.prank(CRE_FORWARDER);
        executor.onReport(_creMetadata(), _cycleReport(scheduledAt, referenceTick));
    }

    function test_creWorkflowNameMatchesProductionHashTruncationAndMetadataIsCanonical() public pure {
        bytes32 digest = sha256(bytes("revenue-v1"));
        bytes memory digestHex = bytes(_toHexString(abi.encodePacked(digest)));
        bytes10 expected;
        assembly ("memory-safe") {
            expected := mload(add(digestHex, 32))
        }
        assertEq(CRE_WORKFLOW_NAME, expected);
        assertEq(_creMetadata().length, 62);
    }

    function test_manualFallbackIsRevenueAuthorityOnly() public {
        _configureValidDelegation();
        address outsider = makeAddr("manualOutsider");
        int24 referenceTick = router.currentMainPoolTick();
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolRevenueMetaMaskExecutorV1.OnlyRevenueAuthority.selector, outsider)
        );
        vm.prank(outsider);
        executor.executeCycle(referenceTick);
    }

    function _configureValidDelegation() private returns (bytes memory permission) {
        ProtocolRevenueDelegation[] memory delegations = _delegations(address(executor));
        bytes32 typedDataHash = _delegationTypedDataHash(delegations[0]);
        vm.mockCall(
            REVENUE_AUTHORITY,
            abi.encodeCall(IERC1271.isValidSignature, (typedDataHash, delegations[0].signature)),
            abi.encode(EIP1271_MAGIC_VALUE)
        );
        permission = abi.encode(delegations);
        vm.prank(REVENUE_AUTHORITY);
        executor.configureDelegation(permission);
    }

    function _delegationTypedDataHash(ProtocolRevenueDelegation memory delegation) private view returns (bytes32) {
        IProtocolRevenueMetaMaskDelegationManagerV1 manager =
            IProtocolRevenueMetaMaskDelegationManagerV1(METAMASK_DELEGATION_MANAGER);
        return keccak256(abi.encodePacked("\x19\x01", manager.getDomainHash(), manager.getDelegationHash(delegation)));
    }

    function _delegations(address delegate) private view returns (ProtocolRevenueDelegation[] memory delegations) {
        ProtocolRevenueCaveat[] memory caveats = new ProtocolRevenueCaveat[](1);
        caveats[0] = ProtocolRevenueCaveat({
            enforcer: address(enforcer), terms: executor.expectedDelegationTerms(), args: bytes("")
        });
        delegations = new ProtocolRevenueDelegation[](1);
        delegations[0] = ProtocolRevenueDelegation({
            delegate: delegate,
            delegator: REVENUE_AUTHORITY,
            authority: bytes32(type(uint256).max),
            caveats: caveats,
            salt: 1,
            signature: new bytes(65)
        });
    }

    function _mockedCompleteBatch() private returns (ProtocolRevenueExecution[] memory executions) {
        uint256 classicV1 = 1 ether;
        uint256 classicV2 = 2 ether;
        uint256 classicV3 = 3 ether;
        uint256 deepV1 = 4 ether;
        uint256 authorityBalance = 5 ether;
        vm.mockCall(
            CLASSIC_V1_HOOK, abi.encodeCall(IProtocolRevenueEthFeeHookV1.launcherFeesAccrued, ()), abi.encode(classicV1)
        );
        vm.mockCall(
            CLASSIC_V2_HOOK, abi.encodeCall(IProtocolRevenueEthFeeHookV1.launcherFeesAccrued, ()), abi.encode(classicV2)
        );
        vm.mockCall(
            CLASSIC_V3_HOOK, abi.encodeCall(IProtocolRevenueEthFeeHookV1.launcherFeesAccrued, ()), abi.encode(classicV3)
        );
        vm.mockCall(
            DEEP_V1_HOOK, abi.encodeCall(IProtocolRevenueEthFeeHookV1.launcherFeesAccrued, ()), abi.encode(deepV1)
        );
        vm.deal(REVENUE_AUTHORITY, authorityBalance);

        executions = new ProtocolRevenueExecution[](6);
        executions[0] = ProtocolRevenueExecution({
            target: CLASSIC_V1_HOOK,
            value: 0,
            callData: abi.encodeCall(IProtocolRevenueEthFeeHookV1.claimLauncherFeesTo, (address(router)))
        });
        executions[1] = ProtocolRevenueExecution({
            target: CLASSIC_V2_HOOK,
            value: 0,
            callData: abi.encodeCall(IProtocolRevenueEthFeeHookV1.claimLauncherFeesTo, (address(router)))
        });
        executions[2] = ProtocolRevenueExecution({
            target: CLASSIC_V3_HOOK,
            value: 0,
            callData: abi.encodeCall(IProtocolRevenueEthFeeHookV1.claimLauncherFeesTo, (address(router)))
        });
        executions[3] = ProtocolRevenueExecution({
            target: DEEP_V1_HOOK, value: 0, callData: abi.encodeCall(IProtocolRevenueEthFeeHookV1.claimLauncherFees, ())
        });
        executions[4] = ProtocolRevenueExecution({
            target: address(router), value: authorityBalance + deepV1, callData: bytes("")
        });
        executions[5] = ProtocolRevenueExecution({
            target: address(router),
            value: 0,
            callData: abi.encodeCall(
                IProtocolRevenueRouterTargetV1.process, (uint64(block.timestamp), router.currentMainPoolTick())
            )
        });
    }

    function _expectInvalidExecution(
        bytes memory terms,
        bytes32 mode,
        bytes32 delegationHash,
        ProtocolRevenueExecution[] memory executions,
        uint256 index
    ) private {
        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueExecutionEnforcerV1.InvalidExecution.selector, index));
        vm.prank(METAMASK_DELEGATION_MANAGER);
        enforcer.beforeAllHook(
            terms, bytes(""), mode, abi.encode(executions), delegationHash, REVENUE_AUTHORITY, address(executor)
        );
    }

    function _totalHookFees() private view returns (uint256 total) {
        total += IProtocolRevenueEthFeeHookV1(CLASSIC_V1_HOOK).launcherFeesAccrued();
        total += IProtocolRevenueEthFeeHookV1(CLASSIC_V2_HOOK).launcherFeesAccrued();
        total += IProtocolRevenueEthFeeHookV1(CLASSIC_V3_HOOK).launcherFeesAccrued();
        total += IProtocolRevenueEthFeeHookV1(DEEP_V1_HOOK).launcherFeesAccrued();
    }

    function _creMetadata() private pure returns (bytes memory) {
        return _creMetadataFor(CRE_WORKFLOW_NAME, TREASURY);
    }

    function _creMetadataFor(bytes10 workflowName, address workflowOwner) private pure returns (bytes memory) {
        return abi.encodePacked(CRE_WORKFLOW_ID, workflowName, workflowOwner);
    }

    function _cycleReport(uint64 scheduledAt, int24 referenceTick) private pure returns (bytes memory) {
        return abi.encode(ETHEREUM_MAINNET_CHAIN_SELECTOR, scheduledAt, referenceTick);
    }

    function _toHexString(bytes memory data) private pure returns (string memory) {
        bytes16 symbols = "0123456789abcdef";
        bytes memory encoded = new bytes(data.length * 2);
        for (uint256 i; i < data.length; ++i) {
            encoded[i * 2] = symbols[uint8(data[i] >> 4)];
            encoded[i * 2 + 1] = symbols[uint8(data[i] & 0x0f)];
        }
        return string(encoded);
    }
}
