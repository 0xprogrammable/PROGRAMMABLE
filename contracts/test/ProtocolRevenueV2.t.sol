// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Test } from "forge-std/Test.sol";

import { ProtocolRevenueClaimCoordinatorV2 } from "../src/ProtocolRevenueClaimCoordinatorV2.sol";
import { ProtocolRevenueVaultV2 } from "../src/ProtocolRevenueVaultV2.sol";

contract ProtocolRevenuePermissionlessHookMockV2 {
    address internal constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    receive() external payable { }

    function launcherFeeRecipient() external pure returns (address) {
        return REVENUE_AUTHORITY;
    }

    function launcherFeesAccrued() external view returns (uint256) {
        return address(this).balance;
    }

    function claimLauncherFees() external returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) revert();
        (bool sent,) = payable(REVENUE_AUTHORITY).call{ value: amount }("");
        require(sent);
    }
}

contract ProtocolRevenueForceSendV2 {
    constructor() payable { }

    function force(address payable target) external {
        selfdestruct(target);
    }
}

contract ProtocolRevenueV2Test is Test {
    address internal constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant TREASURY = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address internal constant V4_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    address internal constant CLASSIC_V1_HOOK = 0x48bB2672c7fd2a12e7fb5D46c441ccD3726520Cc;
    address internal constant CLASSIC_V2_HOOK = 0x025a386eAa79f6067d29848FD05ccC71bEAb20CC;

    ProtocolRevenueClaimCoordinatorV2 internal coordinator;
    ProtocolRevenueVaultV2 internal vault;
    address internal keeper;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        vm.createSelectFork(rpc);
        keeper = makeAddr("protocolRevenueV2Keeper");
        coordinator = new ProtocolRevenueClaimCoordinatorV2(keeper);
        vault = new ProtocolRevenueVaultV2(keeper);
    }

    function test_vaultAcceptsOnlyRevenueAuthorityAndAccountsExactDeposit() public {
        uint256 unallocatedBefore = vault.unallocatedNativeBalance();
        vm.deal(REVENUE_AUTHORITY, 1 ether);
        _deposit(0.25 ether);
        assertEq(vault.pendingRevenue(), 0.25 ether);
        assertEq(vault.totalRevenueDeposited(), 0.25 ether);
        assertEq(address(vault).balance, unallocatedBefore + 0.25 ether);

        vm.deal(address(this), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueVaultV2.OnlyRevenueAuthority.selector, address(this)));
        payable(address(vault)).transfer(0.1 ether);
    }

    function test_vaultRejectsDepositsAbovePermissionCap() public {
        vm.deal(REVENUE_AUTHORITY, 6 ether);
        bytes memory expectedRevert = abi.encodeWithSelector(
            ProtocolRevenueVaultV2.DepositExceedsDailyLimit.selector, 5 ether + 1, vault.MAX_DAILY_REVENUE()
        );
        vm.prank(REVENUE_AUTHORITY);
        (bool accepted, bytes memory revertData) = payable(address(vault)).call{ value: 5 ether + 1 }("");
        assertFalse(accepted);
        assertEq(keccak256(revertData), keccak256(expectedRevert));
    }

    function test_forcedEthNeverEntersRevenueAccounting() public {
        uint256 unallocatedBefore = vault.unallocatedNativeBalance();
        ProtocolRevenueForceSendV2 forceSend = new ProtocolRevenueForceSendV2{ value: 0.4 ether }();
        forceSend.force(payable(address(vault)));
        assertEq(vault.pendingRevenue(), 0);
        assertEq(vault.totalRevenueDeposited(), 0);
        assertEq(vault.unallocatedNativeBalance(), unallocatedBefore + 0.4 ether);
    }

    function test_keeperProcessesExactImmutableSplitThroughLiveMainPool() public {
        uint256 revenue = 0.01 ether;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 keeperBefore = keeper.balance;
        uint256 tokensBefore = IERC20(V4_TOKEN).balanceOf(REVENUE_AUTHORITY);
        vm.deal(REVENUE_AUTHORITY, revenue);
        _deposit(revenue);

        int24 referenceTick = vault.currentMainPoolTick();
        vm.prank(keeper);
        vault.process(uint64(block.timestamp), referenceTick);

        uint256 expectedBuy = (revenue * vault.BUY_SHARE_BPS()) / vault.BASIS_POINTS();
        uint256 expectedKeeper = (revenue * vault.KEEPER_GAS_SHARE_BPS()) / vault.BASIS_POINTS();
        uint256 expectedTreasury = revenue - expectedBuy - expectedKeeper;
        assertEq(TREASURY.balance - treasuryBefore, expectedTreasury);
        assertEq(keeper.balance - keeperBefore, expectedKeeper);
        assertGt(IERC20(V4_TOKEN).balanceOf(REVENUE_AUTHORITY), tokensBefore);
        assertEq(vault.pendingRevenue(), 0);
        assertEq(vault.cycleCount(), 1);
        assertEq(vault.totalRevenueProcessed(), revenue);
        assertEq(vault.totalTreasurySent(), expectedTreasury);
        assertEq(vault.totalKeeperGasSent(), expectedKeeper);
        assertEq(vault.totalNativeSwapped(), expectedBuy);
        assertGt(vault.totalTokensBought(), 0);
    }

    function test_onlyKeeperCanProcess() public {
        vm.deal(REVENUE_AUTHORITY, 0.01 ether);
        _deposit(0.01 ether);
        int24 referenceTick = vault.currentMainPoolTick();
        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueVaultV2.OnlyKeeper.selector, address(this)));
        vault.process(uint64(block.timestamp), referenceTick);
    }

    function test_processRejectsCooldownAndObservationReplay() public {
        vm.deal(REVENUE_AUTHORITY, 0.02 ether);
        _deposit(0.01 ether);
        int24 referenceTick = vault.currentMainPoolTick();
        uint64 observedAt = uint64(block.timestamp);
        vm.prank(keeper);
        vault.process(observedAt, referenceTick);

        _deposit(0.01 ether);
        int24 replayReferenceTick = vault.currentMainPoolTick();
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueVaultV2.ObservationReplay.selector, observedAt, vault.lastAcceptedObservationAt()
            )
        );
        vm.prank(keeper);
        vault.process(observedAt, replayReferenceTick);

        vm.warp(block.timestamp + 1);
        int24 cooldownReferenceTick = vault.currentMainPoolTick();
        uint256 eligibleAt = uint256(vault.lastProcessedAt()) + vault.CYCLE_INTERVAL();
        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueVaultV2.CooldownActive.selector, eligibleAt));
        vm.prank(keeper);
        vault.process(uint64(block.timestamp), cooldownReferenceTick);
    }

    function test_coordinatorClaimsBothHooksToRevenueWallet() public {
        ProtocolRevenuePermissionlessHookMockV2 hookMock = new ProtocolRevenuePermissionlessHookMockV2();
        vm.etch(CLASSIC_V1_HOOK, address(hookMock).code);
        vm.etch(CLASSIC_V2_HOOK, address(hookMock).code);
        vm.deal(CLASSIC_V1_HOOK, 0.004 ether);
        vm.deal(CLASSIC_V2_HOOK, 0.006 ether);
        uint256 recipientBefore = REVENUE_AUTHORITY.balance;

        vm.prank(keeper);
        uint256 claimed = coordinator.claim();

        assertEq(claimed, 0.01 ether);
        assertEq(REVENUE_AUTHORITY.balance - recipientBefore, 0.01 ether);
        assertEq(coordinator.totalClaimed(), 0.01 ether);
        assertEq(coordinator.claimCount(), 1);
        assertEq(CLASSIC_V1_HOOK.balance, 0);
        assertEq(CLASSIC_V2_HOOK.balance, 0);
    }

    function test_coordinatorRejectsNonKeeperAndCooldown() public {
        ProtocolRevenuePermissionlessHookMockV2 hookMock = new ProtocolRevenuePermissionlessHookMockV2();
        vm.etch(CLASSIC_V1_HOOK, address(hookMock).code);
        vm.etch(CLASSIC_V2_HOOK, address(hookMock).code);
        vm.deal(CLASSIC_V1_HOOK, 0.002 ether);

        vm.expectRevert(abi.encodeWithSelector(ProtocolRevenueClaimCoordinatorV2.OnlyKeeper.selector, address(this)));
        coordinator.claim();

        vm.prank(keeper);
        coordinator.claim();
        vm.deal(CLASSIC_V1_HOOK, 0.002 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolRevenueClaimCoordinatorV2.CooldownActive.selector,
                uint256(coordinator.lastClaimedAt()) + coordinator.CLAIM_INTERVAL()
            )
        );
        vm.prank(keeper);
        coordinator.claim();
    }

    function testFuzz_vaultDepositAccounting(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, vault.MAX_DAILY_REVENUE());
        vm.deal(REVENUE_AUTHORITY, amount);
        _deposit(amount);
        assertEq(vault.pendingRevenue(), amount);
        assertEq(vault.totalRevenueDeposited(), amount);
    }

    function _deposit(uint256 amount) private {
        vm.prank(REVENUE_AUTHORITY);
        (bool sent,) = payable(address(vault)).call{ value: amount }("");
        assertTrue(sent);
    }
}
