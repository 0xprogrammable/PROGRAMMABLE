// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { AdaptiveCurveFeeHookFactoryV1 } from "../../src/AdaptiveCurveFeeHookFactoryV1.sol";
import { AdaptiveCurveFeeHookV1 } from "../../src/AdaptiveCurveFeeHookV1.sol";

contract AdaptiveInvariantToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_, uint256 supply) MockERC20("Adaptive Invariant", "AINV", 18) {
        creator = creator_;
        _mint(creator_, supply);
    }
}

contract AdaptiveCurveFeeHookV1Handler {
    using SafeCast for uint256;

    PoolSwapTest internal immutable router;
    AdaptiveCurveFeeHookV1 internal immutable hook;
    IERC20 internal immutable token;
    PoolKey internal key;
    bytes32 internal poolId;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(PoolSwapTest router_, AdaptiveCurveFeeHookV1 hook_, IERC20 token_, PoolKey memory key_) payable {
        router = router_;
        hook = hook_;
        token = token_;
        key = key_;
        poolId = PoolId.unwrap(key_.toId());
        token_.approve(address(router_), type(uint256).max);
    }

    function buyExactInput(uint96 rawAmount) external {
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e14);
        if (address(this).balance < amount) return;
        router.swap{ value: amount }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -amount.toInt256(), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function sellExactInput(uint96 rawAmount) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e14);
        if (amount > balance) amount = balance;
        router.swap(
            key,
            SwapParams({
                zeroForOne: false, amountSpecified: -amount.toInt256(), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function buyExactOutput(uint96 rawAmount) external {
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e12);
        uint256 value = amount * 4;
        if (address(this).balance < value) return;
        router.swap{ value: value }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: amount.toInt256(), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function sellExactOutput(uint96 rawAmount) external {
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e12);
        if (token.balanceOf(address(this)) == 0) return;
        router.swap(
            key,
            SwapParams({
                zeroForOne: false, amountSpecified: amount.toInt256(), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function claimCreator() external {
        (,,,,,, uint256 amount) = hook.poolFeeConfig(poolId);
        if (amount != 0) hook.claimCreatorFees(poolId);
    }

    function claimLauncher() external {
        if (hook.launcherFeesAccrued() != 0) hook.claimLauncherFees();
    }

    receive() external payable { }
}

contract AdaptiveCurveFeeHookV1InvariantTest is Deployers {
    uint256 internal constant FIXED_SUPPLY = 1_000_000_000 ether;

    AdaptiveCurveFeeHookFactoryV1 internal factory;
    AdaptiveCurveFeeHookV1 internal hook;
    AdaptiveInvariantToken internal token;
    AdaptiveCurveFeeHookV1Handler internal handler;
    PoolKey internal hookKey;
    bytes32 internal poolId;
    bytes32 internal curveHash;

    address internal creatorRecipient;
    address internal launcherTreasury;

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1_000_000 ether);

        token = new AdaptiveInvariantToken(address(this), FIXED_SUPPLY);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        factory = new AdaptiveCurveFeeHookFactoryV1();
        launcherTreasury = makeAddr("adaptiveInvariantTreasury");

        (, bytes32 salt) = HookMiner.find(
            address(factory),
            factory.REQUIRED_HOOK_FLAGS(),
            type(AdaptiveCurveFeeHookV1).creationCode,
            abi.encode(manager, launcherTreasury)
        );
        hook = factory.deploy(salt, manager, launcherTreasury);
        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 0,
            tickSpacing: 200,
            hooks: hook
        });
        handler = new AdaptiveCurveFeeHookV1Handler{ value: 10_000 ether }(
            swapRouter, hook, IERC20(address(token)), hookKey
        );
        creatorRecipient = address(handler);

        int24[] memory indexes = new int24[](5);
        indexes[0] = hook.MIN_FDV_INDEX();
        indexes[1] = -10_000;
        indexes[2] = 0;
        indexes[3] = 10_000;
        indexes[4] = hook.MAX_FDV_INDEX();
        uint16[] memory fees = new uint16[](5);
        fees[0] = 1000;
        fees[1] = 800;
        fees[2] = 500;
        fees[3] = 300;
        fees[4] = 100;

        poolId = hook.registerPool(hookKey, creatorRecipient, indexes, fees);
        (,,, curveHash,,,) = hook.poolFeeConfig(poolId);
        manager.initialize(hookKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -20_000, tickUpper: 20_000, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);

        assertTrue(token.transfer(address(handler), 1e24));

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = AdaptiveCurveFeeHookV1Handler.buyExactInput.selector;
        selectors[1] = AdaptiveCurveFeeHookV1Handler.sellExactInput.selector;
        selectors[2] = AdaptiveCurveFeeHookV1Handler.buyExactOutput.selector;
        selectors[3] = AdaptiveCurveFeeHookV1Handler.sellExactOutput.selector;
        selectors[4] = AdaptiveCurveFeeHookV1Handler.claimCreator.selector;
        selectors[5] = AdaptiveCurveFeeHookV1Handler.claimLauncher.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_nativeClaimsCoverAllInternalAccounting() public view {
        uint256 nativeClaims = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        assertGe(nativeClaims, hook.totalNativeFeesAccrued());
        assertEq(manager.balanceOf(address(hook), hookKey.currency1.toId()), 0);

        (,,,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        assertEq(creatorFees + hook.launcherFeesAccrued(), hook.totalNativeFeesAccrued());
    }

    function invariant_curveAndRecipientsNeverChange() public view {
        (
            address creator,
            address registrar,
            uint256 fixedSupply,
            bytes32 actualCurveHash,
            uint8 pointCount,
            bool registered,
        ) = hook.poolFeeConfig(poolId);
        assertEq(creator, creatorRecipient);
        assertEq(registrar, address(this));
        assertEq(fixedSupply, FIXED_SUPPLY);
        assertEq(actualCurveHash, curveHash);
        assertEq(pointCount, 5);
        assertTrue(registered);
        assertEq(hook.launcherFeeRecipient(), launcherTreasury);

        (int24 firstIndex, uint16 firstFee) = hook.curvePoint(poolId, 0);
        (int24 lastIndex, uint16 lastFee) = hook.curvePoint(poolId, 4);
        assertEq(firstIndex, hook.MIN_FDV_INDEX());
        assertEq(firstFee, 1000);
        assertEq(lastIndex, hook.MAX_FDV_INDEX());
        assertEq(lastFee, 100);
    }

    function invariant_currentFeeAlwaysRemainsWithinDisclosedBounds() public view {
        (int24 tick, int24 fdvIndex, uint16 totalSwapFeeBps) = hook.currentFee(poolId);
        assertEq(fdvIndex, -tick);
        assertGe(totalSwapFeeBps, hook.MIN_TOTAL_SWAP_FEE_BPS());
        assertLe(totalSwapFeeBps, hook.MAX_TOTAL_SWAP_FEE_BPS());
    }

    function invariant_callbackMaskRemainsExact() public view {
        assertEq(uint160(address(hook)) & factory.ALL_HOOK_MASK(), factory.REQUIRED_HOOK_FLAGS());
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
    }

    function invariant_feesNeverAccumulateAsLooseHookBalances() public view {
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }
}
