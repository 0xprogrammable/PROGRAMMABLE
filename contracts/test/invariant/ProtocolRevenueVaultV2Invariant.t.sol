// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { ProtocolRevenueVaultV2 } from "../../src/ProtocolRevenueVaultV2.sol";

contract ProtocolRevenueVaultV2Handler is Test {
    address internal constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    ProtocolRevenueVaultV2 public immutable vault;
    address public immutable keeper;

    constructor(ProtocolRevenueVaultV2 vault_, address keeper_) {
        vault = vault_;
        keeper = keeper_;
    }

    function depositAndProcess(uint96 rawRevenue) external {
        uint256 revenue = bound(uint256(rawRevenue), vault.MIN_NEW_REVENUE(), 0.01 ether);
        vm.warp(block.timestamp + vault.CYCLE_INTERVAL());
        vm.roll(block.number + 1);
        vm.deal(REVENUE_AUTHORITY, revenue);
        vm.prank(REVENUE_AUTHORITY);
        (bool deposited,) = payable(address(vault)).call{ value: revenue }("");
        require(deposited);
        int24 referenceTick = vault.currentMainPoolTick();
        vm.prank(keeper);
        try vault.process(uint64(block.timestamp), referenceTick) { } catch { }
    }
}

/// forge-config: default.invariant.runs = 32
/// forge-config: default.invariant.depth = 8
/// forge-config: ci.invariant.runs = 128
/// forge-config: ci.invariant.depth = 16
contract ProtocolRevenueVaultV2InvariantTest is StdInvariant, Test {
    address internal constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant TREASURY = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant V4_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;

    ProtocolRevenueVaultV2 internal vault;
    ProtocolRevenueVaultV2Handler internal handler;
    address internal keeper;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        vm.createSelectFork(rpc);
        keeper = makeAddr("protocolRevenueVaultV2InvariantKeeper");
        vault = new ProtocolRevenueVaultV2(keeper);
        handler = new ProtocolRevenueVaultV2Handler(vault, keeper);
        targetContract(address(handler));
    }

    function invariant_everyProcessedWeiHasExactlyOneDestination() public view {
        assertEq(
            vault.totalRevenueProcessed(),
            vault.totalTreasurySent() + vault.totalKeeperGasSent() + vault.totalNativeSwapped()
        );
    }

    function invariant_pendingAndProcessedNeverExceedDeposits() public view {
        assertEq(vault.totalRevenueDeposited(), vault.totalRevenueProcessed() + vault.pendingRevenue());
    }

    function invariant_immutablePolicyNeverChanges() public view {
        assertEq(vault.REVENUE_AUTHORITY(), REVENUE_AUTHORITY);
        assertEq(vault.TREASURY(), TREASURY);
        assertEq(vault.V4_TOKEN(), V4_TOKEN);
        assertEq(vault.keeper(), keeper);
        assertEq(vault.TREASURY_SHARE_BPS(), 5000);
        assertEq(vault.BUY_SHARE_BPS(), 4950);
        assertEq(vault.KEEPER_GAS_SHARE_BPS(), 50);
        assertEq(vault.MAX_DAILY_REVENUE(), 5 ether);
    }

    function invariant_vaultNeverRetainsPurchasedTokens() public view {
        assertEq(IERC20(V4_TOKEN).balanceOf(address(vault)), 0);
    }
}
