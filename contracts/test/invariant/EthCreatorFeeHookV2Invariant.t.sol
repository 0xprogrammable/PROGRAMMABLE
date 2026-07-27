// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
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

import { EthCreatorFeeHookFactoryV2 } from "../../src/EthCreatorFeeHookFactoryV2.sol";
import { EthCreatorFeeHookV2 } from "../../src/EthCreatorFeeHookV2.sol";

contract InvariantCreatorToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Invariant Token", "INV", 18) {
        creator = creator_;
    }
}

contract EthCreatorFeeHookV2Handler {
    using SafeCast for uint256;

    PoolSwapTest internal immutable router;
    EthCreatorFeeHookV2 internal immutable hook;
    IERC20 internal immutable token;
    PoolKey internal key;
    bytes32 internal poolId;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(PoolSwapTest router_, EthCreatorFeeHookV2 hook_, IERC20 token_, PoolKey memory key_) payable {
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
        (,,,, uint256 amount) = hook.poolFeeConfig(poolId);
        if (amount != 0) hook.claimCreatorFees(poolId);
    }

    function claimLauncher() external {
        if (hook.launcherFeesAccrued() != 0) hook.claimLauncherFees();
    }

    receive() external payable { }
}

contract EthCreatorFeeHookV2InvariantTest is Deployers {
    EthCreatorFeeHookFactoryV2 internal factory;
    EthCreatorFeeHookV2 internal hook;
    InvariantCreatorToken internal token;
    EthCreatorFeeHookV2Handler internal handler;
    PoolKey internal hookKey;
    bytes32 internal poolId;

    address internal creatorRecipient;
    address internal launcherTreasury;

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1_000_000 ether);

        token = new InvariantCreatorToken(address(this));
        token.mint(address(this), 1e36);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        factory = new EthCreatorFeeHookFactoryV2();
        creatorRecipient = makeAddr("invariantCreatorRecipient");
        launcherTreasury = makeAddr("invariantLauncherTreasury");

        (, bytes32 salt) = HookMiner.find(
            address(factory),
            factory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV2).creationCode,
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
        poolId = hook.registerPool(hookKey, creatorRecipient, 1000);
        manager.initialize(hookKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS = ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1e22, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);

        handler =
            new EthCreatorFeeHookV2Handler{ value: 10_000 ether }(swapRouter, hook, IERC20(address(token)), hookKey);
        assertTrue(token.transfer(address(handler), 1e30));

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = EthCreatorFeeHookV2Handler.buyExactInput.selector;
        selectors[1] = EthCreatorFeeHookV2Handler.sellExactInput.selector;
        selectors[2] = EthCreatorFeeHookV2Handler.buyExactOutput.selector;
        selectors[3] = EthCreatorFeeHookV2Handler.sellExactOutput.selector;
        selectors[4] = EthCreatorFeeHookV2Handler.claimCreator.selector;
        selectors[5] = EthCreatorFeeHookV2Handler.claimLauncher.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_nativeClaimsAlwaysCoverInternalAccounting() public view {
        uint256 nativeClaims = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        assertGe(nativeClaims, hook.totalNativeFeesAccrued());
        assertEq(manager.balanceOf(address(hook), hookKey.currency1.toId()), 0);

        (,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        assertEq(creatorFees + hook.launcherFeesAccrued(), hook.totalNativeFeesAccrued());
    }

    function invariant_poolFeeConfigurationNeverChanges() public view {
        (address creator, address registrar, uint16 totalSwapFeeBps, bool registered,) = hook.poolFeeConfig(poolId);
        assertEq(creator, creatorRecipient);
        assertEq(registrar, address(this));
        assertEq(totalSwapFeeBps, 1000);
        assertTrue(registered);
        assertEq(hook.launcherFeeRecipient(), launcherTreasury);
        assertEq(hook.LAUNCHER_FEE_BPS(), 10);
    }

    function invariant_publicFeeDisclosureNeverChanges() public view {
        (
            uint16 buySwapFeeBps,
            uint16 sellSwapFeeBps,
            uint16 creatorFeeBps,
            uint16 launcherFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips
        ) = hook.feeDisclosure(poolId);

        assertEq(buySwapFeeBps, 1000);
        assertEq(sellSwapFeeBps, 1000);
        assertEq(creatorFeeBps, 990);
        assertEq(launcherFeeBps, 10);
        assertEq(transferTaxBps, 0);
        assertEq(lpFeePips, 0);
        assertEq(hook.TRANSFER_TAX_BPS(), 0);
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
