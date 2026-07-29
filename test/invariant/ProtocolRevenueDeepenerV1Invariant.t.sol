// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthCreatorFeeHookFactoryV2 } from "../../src/EthCreatorFeeHookFactoryV2.sol";
import { EthCreatorFeeHookV2 } from "../../src/EthCreatorFeeHookV2.sol";
import { ProtocolRevenueDeepenerBaseV1 } from "../../src/ProtocolRevenueDeepenerV1.sol";

contract InvariantRevenueToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Invariant Revenue", "IRV", 18) {
        creator = creator_;
    }
}

contract InvariantRevenueDeepener is ProtocolRevenueDeepenerBaseV1 {
    constructor(IPoolManager manager, PoolKey memory key)
        ProtocolRevenueDeepenerBaseV1(block.chainid, manager, key, PoolId.unwrap(key.toId()))
    { }
}

contract ProtocolRevenueDeepenerHandler is Test {
    InvariantRevenueDeepener public immutable deepener;
    uint256 public successfulCompounds;
    uint128 public lastLockedLiquidity;

    constructor(InvariantRevenueDeepener deepener_) {
        deepener = deepener_;
        vm.deal(address(this), 10_000 ether);
    }

    function fund(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 0.2 ether);
        deepener.fund{ value: amount }();
    }

    function snapshotPrice() external {
        try deepener.snapshotPrice() { } catch { }
    }

    function advance(uint32 rawSeconds) external {
        uint256 elapsed = bound(uint256(rawSeconds), 1, 8 hours);
        vm.warp(block.timestamp + elapsed);
    }

    function compound() external {
        uint128 beforeLiquidity = deepener.lockedLiquidity();
        try deepener.compound() returns (ProtocolRevenueDeepenerBaseV1.CompoundResult memory) {
            uint128 afterLiquidity = deepener.lockedLiquidity();
            assertGt(afterLiquidity, beforeLiquidity);
            assertGe(afterLiquidity, lastLockedLiquidity);
            lastLockedLiquidity = afterLiquidity;
            ++successfulCompounds;
        } catch { }
    }
}

contract ProtocolRevenueDeepenerV1InvariantTest is StdInvariant, Deployers {
    InvariantRevenueToken internal targetToken;
    EthCreatorFeeHookFactoryV2 internal hookFactory;
    EthCreatorFeeHookV2 internal hook;
    InvariantRevenueDeepener internal deepener;
    ProtocolRevenueDeepenerHandler internal handler;
    PoolKey internal targetKey;

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1000 ether);

        targetToken = new InvariantRevenueToken(address(this));
        targetToken.mint(address(this), 1_000_000 ether);
        targetToken.approve(address(modifyLiquidityRouter), type(uint256).max);

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
        hook.registerPool(targetKey, makeAddr("invariantCreator"), 100);
        manager.initialize(targetKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 20 ether }(targetKey, LIQUIDITY_PARAMS, ZERO_BYTES);

        deepener = new InvariantRevenueDeepener(manager, targetKey);
        assertEq(address(deepener), predictedDeepener);
        handler = new ProtocolRevenueDeepenerHandler(deepener);
        targetContract(address(handler));
    }

    function invariant_lockedLiquidityNeverDecreases() public view {
        assertGe(deepener.lockedLiquidity(), handler.lastLockedLiquidity());
        assertEq(uint256(deepener.lockedLiquidity()), deepener.totalLiquidityAdded());
    }

    function invariant_everyNativeWeiIsPendingOrPermanentlyProcessed() public view {
        assertGe(
            deepener.totalNativeSwapped() + deepener.totalNativeAdded() + address(deepener).balance,
            deepener.totalRevenueReceived()
        );
    }

    function invariant_everyAcquiredTokenIsPendingOrPermanentlyAdded() public view {
        assertGe(
            deepener.totalTokenAdded() + IERC20(address(targetToken)).balanceOf(address(deepener)),
            deepener.totalTokenAcquired()
        );
    }

    function invariant_compoundNonceMatchesSuccessfulCycles() public view {
        assertEq(deepener.compoundNonce(), handler.successfulCompounds());
    }

    function _deployHook(address launcherTreasury) private returns (EthCreatorFeeHookV2 deployed) {
        (address predicted, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV2).creationCode,
            abi.encode(manager, launcherTreasury)
        );
        deployed = hookFactory.deploy(salt, manager, launcherTreasury);
        assertEq(address(deployed), predicted);
    }
}
