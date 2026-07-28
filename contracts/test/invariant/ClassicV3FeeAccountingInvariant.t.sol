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

import { EthCreatorFeeHookFactoryV3 } from "../../src/EthCreatorFeeHookFactoryV3.sol";
import { EthCreatorFeeHookV3 } from "../../src/EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "../../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../../src/FeeSplitVaultV1.sol";
import { IClassicFeeHookV3 } from "../../src/interfaces/IClassicFeeHookV3.sol";

contract ClassicV3InvariantToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Classic V3 Invariant", "CV3I", 18) {
        creator = creator_;
    }
}

contract ClassicV3SwapHandler {
    using SafeCast for uint256;

    PoolSwapTest internal immutable router;
    IERC20 internal immutable token;
    PoolKey internal poolKey;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(PoolSwapTest router_, IERC20 token_, PoolKey memory poolKey_) payable {
        router = router_;
        token = token_;
        poolKey = poolKey_;
        token_.approve(address(router_), type(uint256).max);
    }

    function buyExactInput(uint96 rawAmount) external {
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e14);
        if (address(this).balance < amount) return;
        router.swap{ value: amount }(
            poolKey,
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
            poolKey,
            SwapParams({
                zeroForOne: false, amountSpecified: -amount.toInt256(), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function buyExactOutput(uint96 rawAmount) external {
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e12);
        uint256 value = amount * 5;
        if (address(this).balance < value) return;
        router.swap{ value: value }(
            poolKey,
            SwapParams({
                zeroForOne: true, amountSpecified: amount.toInt256(), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function sellExactOutput(uint96 rawAmount) external {
        if (token.balanceOf(address(this)) == 0) return;
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e12);
        router.swap(
            poolKey,
            SwapParams({
                zeroForOne: false, amountSpecified: amount.toInt256(), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    receive() external payable { }
}

contract ClassicV3FeeAccountingInvariantTest is Deployers {
    EthCreatorFeeHookFactoryV3 internal hookFactory;
    FeeSplitVaultFactoryV1 internal vaultFactory;
    EthCreatorFeeHookV3 internal hook;
    FeeSplitVaultV1 internal vault;
    ClassicV3InvariantToken internal token;
    ClassicV3SwapHandler internal handler;
    PoolKey internal hookKey;
    bytes32 internal poolId;

    address internal beneficiaryA;
    address internal beneficiaryB;
    address internal treasury;

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1_000_000 ether);

        beneficiaryA = makeAddr("beneficiaryA");
        beneficiaryB = makeAddr("beneficiaryB");
        treasury = makeAddr("treasury");
        vaultFactory = new FeeSplitVaultFactoryV1();
        hookFactory = new EthCreatorFeeHookFactoryV3();
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV3).creationCode,
            abi.encode(manager, treasury, vaultFactory)
        );
        hook = hookFactory.deploy(hookSalt, manager, treasury, vaultFactory);

        token = new ClassicV3InvariantToken(address(this));
        token.mint(address(this), 1e36);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 0,
            tickSpacing: 200,
            hooks: hook
        });
        poolId = PoolId.unwrap(hookKey.toId());
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = beneficiaryA;
        beneficiaries[1] = beneficiaryB;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 3333;
        shares[1] = 6667;
        vault = vaultFactory.deploy(
            bytes32("classic-v3-invariant"), IClassicFeeHookV3(address(hook)), poolId, beneficiaries, shares
        );
        hook.registerPool(hookKey, address(vault), 200, 900);
        manager.initialize(hookKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS = ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1e22, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);

        handler = new ClassicV3SwapHandler{ value: 10_000 ether }(swapRouter, IERC20(address(token)), hookKey);
        assertTrue(token.transfer(address(handler), 1e30));

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = ClassicV3SwapHandler.buyExactInput.selector;
        selectors[1] = ClassicV3SwapHandler.sellExactInput.selector;
        selectors[2] = ClassicV3SwapHandler.buyExactOutput.selector;
        selectors[3] = ClassicV3SwapHandler.sellExactOutput.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_nativeClaimsExactlyCoverAccruedAccounting() public view {
        uint256 nativeClaims = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        assertEq(nativeClaims, hook.totalNativeFeesAccrued());
        assertEq(manager.balanceOf(address(hook), hookKey.currency1.toId()), 0);

        (,,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        assertEq(creatorFees + hook.launcherFeesAccrued(), hook.totalNativeFeesAccrued());
    }

    function invariant_directionalEconomicsNeverChange() public view {
        (address rewardVault, address registrar, uint16 buy, uint16 sell, bool registered,) = hook.poolFeeConfig(poolId);
        assertEq(rewardVault, address(vault));
        assertEq(registrar, address(this));
        assertEq(buy, 200);
        assertEq(sell, 900);
        assertTrue(registered);

        (
            uint16 disclosedBuy,
            uint16 disclosedSell,
            uint16 buyCreator,
            uint16 sellCreator,
            uint16 platform,
            uint16 transferTax,
            uint24 lpFee,
            address disclosedVault
        ) = hook.feeDisclosure(poolId);
        assertEq(disclosedBuy, 200);
        assertEq(disclosedSell, 900);
        assertEq(buyCreator, 190);
        assertEq(sellCreator, 890);
        assertEq(platform, 10);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(disclosedVault, address(vault));
    }

    function invariant_rewardConfigurationNeverChanges() public view {
        assertEq(vault.beneficiaryCount(), 2);
        assertEq(vault.beneficiaryAt(0), beneficiaryA);
        assertEq(vault.beneficiaryAt(1), beneficiaryB);
        assertEq(vault.shareBpsOf(beneficiaryA), 3333);
        assertEq(vault.shareBpsOf(beneficiaryB), 6667);
    }

    function invariant_callbackMaskAndLooseBalancesRemainExact() public view {
        assertEq(uint160(address(hook)) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }
}
