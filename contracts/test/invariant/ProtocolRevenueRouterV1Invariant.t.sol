// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { ProtocolRevenueRouterV1 } from "../../src/ProtocolRevenueRouterV1.sol";

contract ProtocolRevenueRouterV1Handler is Test {
    address internal constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    ProtocolRevenueRouterV1 public immutable router;

    constructor(ProtocolRevenueRouterV1 router_) {
        router = router_;
    }

    function processRevenue(uint96 rawRevenue) external {
        uint256 revenue = bound(uint256(rawRevenue), router.MIN_NEW_REVENUE(), 0.02 ether);
        vm.warp(block.timestamp + router.CYCLE_INTERVAL());
        vm.roll(block.number + 1);
        vm.deal(address(router), address(router).balance + revenue);
        int24 referenceTick = router.currentMainPoolTick();
        vm.prank(REVENUE_AUTHORITY);
        try router.process(uint64(block.timestamp), referenceTick, revenue) { } catch { }
    }
}

/// forge-config: default.invariant.runs = 32
/// forge-config: default.invariant.depth = 8
/// forge-config: ci.invariant.runs = 128
/// forge-config: ci.invariant.depth = 16
contract ProtocolRevenueRouterV1InvariantTest is StdInvariant, Test {
    address internal constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant TREASURY = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant V4_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;

    ProtocolRevenueRouterV1 internal router;
    ProtocolRevenueRouterV1Handler internal handler;
    address internal keeper;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        vm.createSelectFork(rpc);
        keeper = makeAddr("protocolRevenueInvariantKeeper");
        router = new ProtocolRevenueRouterV1(keeper);
        handler = new ProtocolRevenueRouterV1Handler(router);
        targetContract(address(handler));
    }

    function invariant_everyProcessedWeiHasExactlyOneDestination() public view {
        assertEq(
            router.totalRevenueProcessed(),
            router.totalTreasurySent() + router.totalKeeperGasSent() + router.totalNativeSwapped()
        );
    }

    function invariant_immutablePolicyNeverChanges() public view {
        assertEq(router.REVENUE_AUTHORITY(), REVENUE_AUTHORITY);
        assertEq(router.TREASURY(), TREASURY);
        assertEq(router.V4_TOKEN(), V4_TOKEN);
        assertEq(router.keeper(), keeper);
        assertEq(router.TREASURY_SHARE_BPS(), 5000);
        assertEq(router.BUY_SHARE_BPS(), 4950);
        assertEq(router.KEEPER_GAS_SHARE_BPS(), 50);
    }

    function invariant_routerNeverRetainsPurchasedTokens() public view {
        assertEq(IERC20(V4_TOKEN).balanceOf(address(router)), 0);
    }

    function invariant_successfulCycleCounterHasARecordedTimestamp() public view {
        if (router.cycleCount() == 0) {
            assertEq(router.lastProcessedAt(), 0);
        } else {
            assertGt(router.lastProcessedAt(), 0);
            assertGe(router.totalRevenueProcessed(), router.cycleCount() * router.MIN_NEW_REVENUE());
        }
    }
}
