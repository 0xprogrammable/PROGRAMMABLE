// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { RobinhoodNative20Initializer } from "../src/RobinhoodNative20Initializer.sol";
import { RobinhoodNative20Token } from "../src/RobinhoodNative20Token.sol";
import { RobinhoodNativeFeeHookV1 } from "../src/robinhood-fee-v1/RobinhoodNativeFeeHookV1.sol";
import { RobinhoodNativeFeeVaultV1 } from "../src/robinhood-fee-v1/RobinhoodNativeFeeVaultV1.sol";

/// @notice Local execution against the actual pinned v4-core implementation, with no live RPC or broadcast.
/// @dev The constructor sequence explicitly proves initializer -> token -> hook forward-reference avoidance.
///      The canonical factory caller is impersonated locally; this is not a signed factory launch test.
contract RobinhoodNative20LaunchTest is Test, IUnlockCallback {
    using StateLibrary for IPoolManager;

    address internal constant MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant FACTORY = 0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd;
    address internal constant TREASURY = 0xD88539d3c4C460136a733A3Fd60cf6BF269079da;
    address internal constant INITIAL_BUYER = address(0xBEEF);
    uint256 internal constant FIRST_BUY = 0.001 ether;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint160 internal constant HOOK_FLAGS = 0x20cc;

    IPoolManager internal manager;
    RobinhoodNative20Initializer internal initializer;
    RobinhoodNative20Token internal token;
    RobinhoodNativeFeeHookV1 internal hook;
    PoolKey internal key;

    function setUp() public {
        vm.chainId(4663);
        vm.deal(address(this), 100 ether);
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), MANAGER);
        manager = IPoolManager(MANAGER);
        _deployExample(0, 0);
    }

    function _deployExample(uint16 creatorBuyFeeBps, uint16 creatorSellFeeBps) internal {
        initializer = new RobinhoodNative20Initializer(manager, FACTORY);
        token = new RobinhoodNative20Token(address(initializer));
        RobinhoodNativeFeeHookV1.PoolConfig memory config = RobinhoodNativeFeeHookV1.PoolConfig({
            token: address(token),
            lpFee: 0,
            tickSpacing: 60,
            initialSqrtPriceX96: TickMath.getSqrtPriceAtTick(200_040),
            initializer: address(initializer),
            creatorFeeRecipient: address(this),
            creatorBuyFeeBps: creatorBuyFeeBps,
            creatorSellFeeBps: creatorSellFeeBps,
            module: address(0),
            maxModuleLpFeePips: 0
        });
        (, bytes32 salt) = HookMiner.find(
            address(this), HOOK_FLAGS, type(RobinhoodNativeFeeHookV1).creationCode, abi.encode(manager, config)
        );
        hook = new RobinhoodNativeFeeHookV1{ salt: salt }(manager, config);
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 0, 60, IHooks(address(hook)));
    }

    function test_forwardOnlyConstructorOrderFundsFixedTokenInventory() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
        assertEq(token.balanceOf(address(initializer)), TOTAL_SUPPLY);
        assertEq(address(initializer).balance, 0);
        assertEq(hook.token(), address(token));
        assertEq(hook.initializer(), address(initializer));
        assertEq(hook.creatorBuyFeeBps(), 0);
        assertEq(hook.creatorSellFeeBps(), 0);
    }

    function test_launchSeedsLockedPositionAndExecutesFundedFirstBuyAtomically() public {
        assertEq(initializer.initialSqrtPriceX96(), 1_747_735_933_952_748_037_356_115_466_503_453);
        _launch();
        (uint128 liquidity,,) = manager.getPositionInfo(key.toId(), address(initializer), 160_020, 200_040, bytes32(0));
        assertGt(liquidity, 0);
        assertEq(MANAGER.balance, FIRST_BUY);
        assertEq(address(initializer).balance, 0);
        assertEq(
            token.balanceOf(MANAGER) + token.balanceOf(address(initializer)) + token.balanceOf(INITIAL_BUYER),
            TOTAL_SUPPLY
        );
        assertGt(token.balanceOf(INITIAL_BUYER), 0);
        assertEq(initializer.initialBuyer(), INITIAL_BUYER);
        assertEq(initializer.initialBuyWei(), FIRST_BUY);
        assertEq(initializer.initialTokensOut(), token.balanceOf(INITIAL_BUYER));
        assertGt(manager.getLiquidity(key.toId()), 0);
        assertGt(initializer.seededTokenAmount(), TOTAL_SUPPLY - 1_000_000);
        assertEq(manager.balanceOf(address(initializer), 0), 0);
        assertEq(manager.balanceOf(address(hook.feeVault()), 0), _ceil(FIRST_BUY * 20, 10_000));
        assertEq(token.allowance(address(initializer), address(this)), 0);
    }

    function test_firstBuyerFundsNativeReserveAndCanSellBackWithTreasuryFees() public {
        _launch();
        uint256 initialPlatform = hook.feeVault().platformAccrued();
        uint256 grossBuy = 0.01 ether;
        uint256 nativeBefore = MANAGER.balance;
        BalanceDelta buy = _swap(true, -int256(grossBuy));
        uint256 platformBuy = grossBuy * 20 / 10_000;
        uint256 tokensBought = uint256(int256(buy.amount1()));
        assertEq(-int256(buy.amount0()), int256(grossBuy));
        assertGt(tokensBought, 0);
        assertEq(token.balanceOf(address(this)), tokensBought);
        assertEq(MANAGER.balance - nativeBefore, grossBuy);
        assertEq(hook.feeVault().platformAccrued(), initialPlatform + platformBuy);

        uint256 reserveBeforeSell = MANAGER.balance;
        uint256 tokenSell = tokensBought / 2;
        BalanceDelta sell = _swap(false, -int256(tokenSell));
        assertGt(sell.amount0(), 0);
        assertEq(-int256(sell.amount1()), int256(tokenSell));
        assertLt(MANAGER.balance, reserveBeforeSell);
        uint256 totalPlatform = hook.feeVault().platformAccrued();
        uint256 platformSell = totalPlatform - initialPlatform - platformBuy;
        uint256 grossSell = uint256(int256(sell.amount0())) + platformSell;
        assertEq(platformSell, _ceil(grossSell * 20, 10_000));
        assertEq(hook.feeVault().creatorAccrued(), 0);
        assertEq(manager.balanceOf(address(hook.feeVault()), 0), totalPlatform);

        uint256 treasuryBefore = TREASURY.balance;
        RobinhoodNativeFeeVaultV1 vault = hook.feeVault();
        vm.prank(makeAddr("independentFeeClaimCaller"));
        uint256 claimed = vault.claimPlatform();
        assertEq(claimed, totalPlatform);
        assertEq(TREASURY.balance - treasuryBefore, totalPlatform);
        assertEq(hook.feeVault().platformAccrued(), 0);
        assertEq(manager.balanceOf(address(hook.feeVault()), 0), 0);
        assertGt(MANAGER.balance, 0);

        (uint128 liquidity,,) = manager.getPositionInfo(key.toId(), address(initializer), 160_020, 200_040, bytes32(0));
        assertGt(liquidity, 0);
    }

    function test_directionalCreatorFeesPreservePlatformShareAndLockedPrincipal() public {
        _deployExample(300, 700);
        _launch();
        (uint128 initialLiquidity,,) =
            manager.getPositionInfo(key.toId(), address(initializer), 160_020, 200_040, bytes32(0));
        assertGt(initialLiquidity, 0);
        assertEq(MANAGER.balance, FIRST_BUY);

        uint256 initialPlatform = hook.feeVault().platformAccrued();
        uint256 initialCreator = hook.feeVault().creatorAccrued();
        uint256 grossBuy = 0.01 ether;
        BalanceDelta buy = _swap(true, -int256(grossBuy));
        uint256 platformBuy = _ceil(grossBuy * 20, 10_000);
        uint256 creatorBuy = _ceil(grossBuy * 320, 10_000) - platformBuy;
        assertEq(-int256(buy.amount0()), int256(grossBuy));
        assertGt(buy.amount1(), 0);
        RobinhoodNativeFeeVaultV1 vault = hook.feeVault();
        assertEq(vault.platformAccrued(), initialPlatform + platformBuy);
        assertEq(vault.creatorAccrued(), initialCreator + creatorBuy);

        uint256 tokensSold = uint256(int256(buy.amount1())) / 2;
        BalanceDelta sell = _swap(false, -int256(tokensSold));
        uint256 platformSell = vault.platformAccrued() - initialPlatform - platformBuy;
        uint256 creatorSell = vault.creatorAccrued() - initialCreator - creatorBuy;
        uint256 grossSell = uint256(int256(sell.amount0())) + platformSell + creatorSell;
        assertGt(sell.amount0(), 0);
        assertEq(-int256(sell.amount1()), int256(tokensSold));
        assertEq(platformSell, _ceil(grossSell * 20, 10_000));
        assertEq(creatorSell, _ceil(grossSell * 720, 10_000) - platformSell);

        _claimBoth(vault, initialPlatform + platformBuy + platformSell, initialCreator + creatorBuy + creatorSell);

        (uint128 finalLiquidity,,) =
            manager.getPositionInfo(key.toId(), address(initializer), 160_020, 200_040, bytes32(0));
        assertEq(finalLiquidity, initialLiquidity);
        assertEq(token.allowance(address(initializer), address(this)), 0);
        assertFalse(manager.isOperator(address(initializer), FACTORY));
        assertGt(MANAGER.balance, 0);
    }

    function test_untrustedCallerCannotInitialize() public {
        vm.expectRevert();
        initializer.initialize(address(token), address(hook), INITIAL_BUYER, 1);
        assertEq(token.balanceOf(address(initializer)), TOTAL_SUPPLY);
        assertEq(token.balanceOf(MANAGER), 0);
    }

    function test_factoryCannotInitializeTwice() public {
        _launch();
        uint256 poolTokens = token.balanceOf(MANAGER);
        vm.prank(FACTORY);
        vm.expectRevert();
        initializer.initialize(address(token), address(hook), INITIAL_BUYER, 1);
        assertEq(token.balanceOf(MANAGER), poolTokens);
    }

    function test_forgedUnlockCannotSpendTokenInventory() public {
        vm.expectRevert();
        initializer.unlockCallback("");
        vm.prank(MANAGER);
        vm.expectRevert();
        initializer.unlockCallback("");
        assertEq(token.balanceOf(address(initializer)), TOTAL_SUPPLY);
        assertEq(token.balanceOf(MANAGER), 0);
    }

    function test_initializerHasNoWithdrawalOrApprovalEntryPoint() public {
        _launch();
        bytes[4] memory attempts = [
            abi.encodeWithSignature("withdraw(address,uint256)", address(this), 1),
            abi.encodeWithSignature("removeLiquidity(uint256)", 1),
            abi.encodeWithSignature("approve(address,uint256)", address(this), type(uint256).max),
            abi.encodeWithSignature("execute(address,bytes)", MANAGER, bytes(""))
        ];
        for (uint256 i; i < attempts.length; i++) {
            vm.prank(FACTORY);
            (bool success,) = address(initializer).call(attempts[i]);
            assertFalse(success);
        }
        (uint128 liquidity,,) = manager.getPositionInfo(key.toId(), address(initializer), 160_020, 200_040, bytes32(0));
        assertGt(liquidity, 0);
        assertEq(token.allowance(address(initializer), address(this)), 0);
        assertFalse(manager.isOperator(address(initializer), FACTORY));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == MANAGER);
        SwapParams memory params = abi.decode(data, (SwapParams));
        BalanceDelta delta = manager.swap(key, params, "");
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _launch() internal {
        vm.deal(FACTORY, FIRST_BUY);
        vm.prank(FACTORY);
        initializer.initialize{ value: FIRST_BUY }(address(token), address(hook), INITIAL_BUYER, 1);
    }

    function test_zeroInitialBuyCannotLeaveAnEmptyLaunch() public {
        vm.prank(FACTORY);
        vm.expectRevert(RobinhoodNative20Initializer.InvalidInitialBuy.selector);
        initializer.initialize(address(token), address(hook), INITIAL_BUYER, 1);
        assertFalse(initializer.initialized());
        assertEq(token.balanceOf(address(initializer)), TOTAL_SUPPLY);
        assertEq(MANAGER.balance, 0);
        (uint160 price,,,) = manager.getSlot0(key.toId());
        assertEq(price, 0);
    }

    function test_unfillableMinimumRollsBackSeedBuyAndFees() public {
        vm.deal(FACTORY, FIRST_BUY);
        vm.prank(FACTORY);
        vm.expectRevert(RobinhoodNative20Initializer.InvalidInitialBuy.selector);
        initializer.initialize{ value: FIRST_BUY }(address(token), address(hook), INITIAL_BUYER, TOTAL_SUPPLY);
        assertFalse(initializer.initialized());
        assertEq(token.balanceOf(address(initializer)), TOTAL_SUPPLY);
        assertEq(token.balanceOf(INITIAL_BUYER), 0);
        assertEq(MANAGER.balance, 0);
        assertEq(hook.feeVault().platformAccrued(), 0);
        (uint160 price,,,) = manager.getSlot0(key.toId());
        assertEq(price, 0);
    }

    function test_zeroMinimumOrRecipientCannotLaunch() public {
        vm.deal(FACTORY, FIRST_BUY);
        vm.startPrank(FACTORY);
        vm.expectRevert(RobinhoodNative20Initializer.InvalidInitialBuy.selector);
        initializer.initialize{ value: FIRST_BUY }(address(token), address(hook), INITIAL_BUYER, 0);
        vm.expectRevert(RobinhoodNative20Initializer.InvalidInitialBuy.selector);
        initializer.initialize{ value: FIRST_BUY }(address(token), address(hook), address(0), 1);
        vm.stopPrank();
        assertFalse(initializer.initialized());
    }

    function _swap(bool buy, int256 amount) internal returns (BalanceDelta) {
        SwapParams memory params = SwapParams({
            zeroForOne: buy,
            amountSpecified: amount,
            sqrtPriceLimitX96: buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        return abi.decode(manager.unlock(abi.encode(params)), (BalanceDelta));
    }

    function _settle(Currency currency, int128 amount) internal {
        if (amount < 0) {
            uint256 owed = uint256(-int256(amount));
            manager.sync(currency);
            if (Currency.unwrap(currency) == address(0)) {
                manager.settle{ value: owed }();
            } else {
                token.transfer(MANAGER, owed);
                manager.settle();
            }
        } else if (amount > 0) {
            manager.take(currency, address(this), uint256(int256(amount)));
        }
    }

    function _claimBoth(RobinhoodNativeFeeVaultV1 vault, uint256 platformTotal, uint256 creatorTotal) internal {
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = address(this).balance;
        vm.startPrank(makeAddr("directionalFeeClaimCaller"));
        assertEq(vault.claimCreator(), creatorTotal);
        assertEq(manager.balanceOf(address(vault), 0), platformTotal);
        assertEq(vault.claimPlatform(), platformTotal);
        vm.stopPrank();
        assertEq(TREASURY.balance - treasuryBefore, platformTotal);
        assertEq(address(this).balance - creatorBefore, creatorTotal);
        assertEq(manager.balanceOf(address(vault), 0), 0);
    }

    function _ceil(uint256 numerator, uint256 denominator) internal pure returns (uint256) {
        return numerator == 0 ? 0 : (numerator - 1) / denominator + 1;
    }

    receive() external payable { }
}
