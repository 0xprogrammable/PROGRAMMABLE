// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthCreatorFeeHookFactoryV4 } from "../../src/EthCreatorFeeHookFactoryV4.sol";
import { EthCreatorFeeHookV4 } from "../../src/EthCreatorFeeHookV4.sol";
import { FeeSplitVaultFactoryV1 } from "../../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../../src/FeeSplitVaultV1.sol";
import { IClassicFeeHookV3 } from "../../src/interfaces/IClassicFeeHookV3.sol";

contract ClassicV4SecurityToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Classic V4 Security", "CV4S", 18) {
        creator = creator_;
    }
}

contract ClassicV4ReentrantTreasury {
    EthCreatorFeeHookV4 internal hook;
    bool internal armed;

    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryError;
    uint256 public receivedNative;

    function configure(EthCreatorFeeHookV4 hook_) external {
        require(address(hook) == address(0));
        hook = hook_;
    }

    function claim() external returns (uint256 amount) {
        armed = true;
        amount = hook.claimLauncherFeesTo(address(this));
        armed = false;
    }

    receive() external payable {
        receivedNative += msg.value;
        if (!armed) return;

        armed = false;
        reentryAttempted = true;
        (bool success, bytes memory revertData) =
            address(hook).call(abi.encodeCall(EthCreatorFeeHookV4.claimLauncherFees, ()));
        reentrySucceeded = success;
        if (!success && revertData.length >= 4) {
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(revertData, 0x20))
            }
            reentryError = selector;
        }
    }
}

contract ClassicV4ReentrantBeneficiary {
    FeeSplitVaultV1 internal vault;
    bool internal armed;

    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryError;
    uint256 public receivedNative;

    function configure(FeeSplitVaultV1 vault_) external {
        require(address(vault) == address(0));
        vault = vault_;
    }

    function claim() external returns (uint256 amount) {
        armed = true;
        amount = vault.claim();
        armed = false;
    }

    receive() external payable {
        receivedNative += msg.value;
        if (!armed) return;

        armed = false;
        reentryAttempted = true;
        (bool success, bytes memory revertData) = address(vault).call(abi.encodeCall(FeeSplitVaultV1.claim, ()));
        reentrySucceeded = success;
        if (!success && revertData.length >= 4) {
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(revertData, 0x20))
            }
            reentryError = selector;
        }
    }
}

contract EthCreatorFeeHookV4SecurityTest is Deployers {
    EthCreatorFeeHookFactoryV4 internal hookFactory;
    FeeSplitVaultFactoryV1 internal vaultFactory;
    EthCreatorFeeHookV4 internal hook;
    FeeSplitVaultV1 internal vault;
    ClassicV4SecurityToken internal token;
    ClassicV4ReentrantTreasury internal treasury;
    ClassicV4ReentrantBeneficiary internal beneficiary;
    PoolKey internal hookKey;
    bytes32 internal poolId;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1000 ether);

        treasury = new ClassicV4ReentrantTreasury();
        beneficiary = new ClassicV4ReentrantBeneficiary();
        vaultFactory = new FeeSplitVaultFactoryV1();
        hookFactory = new EthCreatorFeeHookFactoryV4();
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV4).creationCode,
            abi.encode(manager, address(treasury), vaultFactory)
        );
        hook = hookFactory.deploy(hookSalt, manager, address(treasury), vaultFactory);
        treasury.configure(hook);

        token = new ClassicV4SecurityToken(address(this));
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 0,
            tickSpacing: 200,
            hooks: hook
        });
        poolId = PoolId.unwrap(hookKey.toId());

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = address(beneficiary);
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        vault = vaultFactory.deploy(
            bytes32("classic-v4-security"), IClassicFeeHookV3(address(hook)), poolId, beneficiaries, shares
        );
        beneficiary.configure(vault);

        hook.registerPool(hookKey, address(vault), 110, 370);
        manager.initialize(hookKey, SQRT_PRICE_1_1);
        ModifyLiquidityParams memory liquidity =
            ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 20 ether }(hookKey, liquidity, ZERO_BYTES);
    }

    function test_treasuryClaimBlocksReceiveReentrancyAndPreservesPayout() public {
        _buyExactInput(0.1 ether);
        uint256 launcherFees = hook.launcherFeesAccrued();
        (,,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        assertGt(launcherFees, 0);
        assertGt(creatorFees, 0);

        assertEq(treasury.claim(), launcherFees);

        assertEq(treasury.receivedNative(), launcherFees);
        assertTrue(treasury.reentryAttempted());
        assertFalse(treasury.reentrySucceeded());
        assertEq(treasury.reentryError(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(hook.launcherFeesAccrued(), 0);
        assertEq(hook.totalNativeFeesAccrued(), creatorFees);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), creatorFees);
    }

    function test_creatorClaimBlocksPayoutReentrancyAndPreservesPayout() public {
        _buyExactInput(0.1 ether);
        (,,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        uint256 launcherFees = hook.launcherFeesAccrued();
        assertGt(creatorFees, 0);

        assertEq(beneficiary.claim(), creatorFees);

        assertEq(beneficiary.receivedNative(), creatorFees);
        assertTrue(beneficiary.reentryAttempted());
        assertFalse(beneficiary.reentrySucceeded());
        assertEq(beneficiary.reentryError(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(vault.totalCreatorFeesReceived(), creatorFees);
        assertEq(vault.totalCreatorFeesClaimed(), creatorFees);
        assertEq(vault.claimedBy(address(beneficiary)), creatorFees);
        (,,,,, uint256 creatorFeesAfter) = hook.poolFeeConfig(poolId);
        assertEq(creatorFeesAfter, 0);
        assertEq(hook.totalNativeFeesAccrued(), launcherFees);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), launcherFees);
    }

    function test_tightBuyPartialFillRevertsAndRollsBackAllFeeAccounting() public {
        _assertNoFeesAccrued();

        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        swapRouter.swap{ value: 1 ether }(
            hookKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(-1)
            }),
            settings,
            ""
        );

        _assertNoFeesAccrued();
    }

    function test_tightSellExactOutputPartialFillRevertsAndRollsBackAllFeeAccounting() public {
        _assertNoFeesAccrued();

        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        swapRouter.swap(
            hookKey,
            SwapParams({
                zeroForOne: false, amountSpecified: int256(0.1 ether), sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(1)
            }),
            settings,
            ""
        );

        _assertNoFeesAccrued();
    }

    function _buyExactInput(uint256 amount) private {
        swapRouter.swap{ value: amount }(
            hookKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function _assertNoFeesAccrued() private view {
        (,,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        assertEq(creatorFees, 0);
        assertEq(hook.launcherFeesAccrued(), 0);
        assertEq(hook.totalNativeFeesAccrued(), 0);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), 0);
    }
}
