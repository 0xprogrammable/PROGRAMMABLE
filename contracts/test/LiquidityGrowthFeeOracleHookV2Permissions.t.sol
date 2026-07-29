// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { LiquidityGrowthFeeOracleHookFactoryV2 } from "../src/LiquidityGrowthFeeOracleHookFactoryV2.sol";
import { LiquidityGrowthFeeOracleHookV2 } from "../src/LiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "../src/LiquidityGrowthFullRangePolicyV3.sol";
import { ILiquidityGrowthFullRangeVaultFactoryV3 } from "../src/interfaces/ILiquidityGrowthFeeOracleHookV2.sol";

contract DeepV3PermissionVaultFactory is ILiquidityGrowthFullRangeVaultFactoryV3 {
    mapping(address vault => bytes32 configurationHash) public configurationHashOf;
    mapping(address vault => bytes32 bindingHash) public vaultBindingHash;

    function register(address vault, address hook, bytes32 poolId, address token) external {
        configurationHashOf[vault] = keccak256(abi.encode(block.chainid, address(this), vault));
        vaultBindingHash[vault] = keccak256(abi.encode(block.chainid, address(this), vault, hook, poolId, token));
    }
}

contract DeepV3PermissionToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Deep Permission Token", "DPT", 18) {
        creator = creator_;
    }
}

contract DeepV3PermissionVault is IUnlockCallback {
    using CurrencySettler for Currency;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    IPoolManager public immutable manager;
    uint8 public stateAfterSwap;
    uint8 public stateAfterAdd;
    bytes32 public digestAfterSwap;
    bytes32 public digestAfterAdd;

    error UnauthorizedCallback(address caller);
    error InvalidSwapResult(int128 nativeDelta, int128 tokenDelta);
    error ZeroLiquidity();

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function arm(LiquidityGrowthFeeOracleHookV2 hook, bytes32 poolId, bytes32 digest) external {
        hook.armCompound(poolId, digest);
    }

    function armTwice(LiquidityGrowthFeeOracleHookV2 hook, bytes32 poolId, bytes32 digest) external {
        hook.armCompound(poolId, digest);
        hook.armCompound(poolId, digest);
    }

    function close(LiquidityGrowthFeeOracleHookV2 hook, bytes32 poolId, bytes32 digest) external {
        hook.closeCompound(poolId, digest);
    }

    function compound(LiquidityGrowthFeeOracleHookV2 hook, PoolKey calldata key, bytes32 digest, uint256 swapNative)
        external
    {
        bytes32 poolId = PoolId.unwrap(key.toId());
        hook.armCompound(poolId, digest);
        manager.unlock(abi.encode(uint8(1), hook, key, digest, swapNative));
        hook.closeCompound(poolId, digest);
    }

    function attemptInternalSwap(
        LiquidityGrowthFeeOracleHookV2 hook,
        bytes32 armedPoolId,
        PoolKey calldata key,
        bytes32 armedDigest,
        bytes32 suppliedDigest,
        bytes32 tag,
        bool zeroForOne,
        int256 amountSpecified
    ) external {
        hook.armCompound(armedPoolId, armedDigest);
        manager.unlock(abi.encode(uint8(2), key, suppliedDigest, tag, zeroForOne, amountSpecified));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert UnauthorizedCallback(msg.sender);
        uint8 action = abi.decode(data, (uint8));
        if (action == 1) return _compound(data);
        _swapOnly(data);
        return "";
    }

    function _compound(bytes calldata data) private returns (bytes memory) {
        (, LiquidityGrowthFeeOracleHookV2 hook, PoolKey memory key, bytes32 digest, uint256 swapNative) =
            abi.decode(data, (uint8, LiquidityGrowthFeeOracleHookV2, PoolKey, bytes32, uint256));
        bytes32 poolId = PoolId.unwrap(key.toId());
        BalanceDelta swapDelta = manager.swap(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(swapNative), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            abi.encode(hook.COMPOUND_DOMAIN_TAG(), digest)
        );
        (stateAfterSwap, digestAfterSwap) = hook.compoundIntentState(poolId);
        int128 nativeDelta = swapDelta.amount0();
        int128 tokenDelta = swapDelta.amount1();
        if (nativeDelta >= 0 || tokenDelta <= 0) revert InvalidSwapResult(nativeDelta, tokenDelta);

        (uint160 sqrtPriceX96,,,) = manager.getSlot0(PoolId.wrap(poolId));
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_LOWER),
            TickMath.getSqrtPriceAtTick(Policy.FULL_RANGE_TICK_UPPER),
            swapNative / 2,
            uint256(int256(tokenDelta)) / 2
        );
        if (liquidity == 0) revert ZeroLiquidity();
        manager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: Policy.FULL_RANGE_TICK_LOWER,
                tickUpper: Policy.FULL_RANGE_TICK_UPPER,
                liquidityDelta: int256(uint256(liquidity)),
                salt: Policy.LOCKED_POSITION_SALT
            }),
            abi.encode(hook.COMPOUND_DOMAIN_TAG(), digest)
        );
        (stateAfterAdd, digestAfterAdd) = hook.compoundIntentState(poolId);
        _settle(key.currency0);
        _settle(key.currency1);
        return abi.encode(liquidity);
    }

    function _swapOnly(bytes calldata data) private {
        (, PoolKey memory key, bytes32 suppliedDigest, bytes32 tag, bool zeroForOne, int256 amountSpecified) =
            abi.decode(data, (uint8, PoolKey, bytes32, bytes32, bool, int256));
        manager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(tag, suppliedDigest)
        );
        _settle(key.currency0);
        _settle(key.currency1);
    }

    function _settle(Currency currency) private {
        int256 delta = manager.currencyDelta(address(this), currency);
        if (delta < 0) {
            currency.settle(manager, address(this), uint256(-delta), false);
        } else if (delta > 0) {
            currency.take(manager, address(this), uint256(delta), false);
        }
    }

    receive() external payable {
        if (msg.sender != address(manager)) revert UnauthorizedCallback(msg.sender);
    }
}

contract LiquidityGrowthFeeOracleHookV2PermissionsTest is Deployers, IUnlockCallback {
    using CurrencySettler for Currency;
    using StateLibrary for IPoolManager;

    uint256 private constant INITIAL_BUY = 0.01 ether;
    Currency private constant NATIVE = Currency.wrap(address(0));

    LiquidityGrowthFeeOracleHookFactoryV2 private hookFactory;
    LiquidityGrowthFeeOracleHookV2 private hook;
    DeepV3PermissionVaultFactory private vaultFactory;
    DeepV3PermissionVault private growthVault;
    DeepV3PermissionToken private token;
    PoolKey private deepKey;
    bytes32 private poolId;
    bytes32 private hookSalt;
    address private treasury;

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        treasury = makeAddr("deepV3PermissionTreasury");
        vaultFactory = new DeepV3PermissionVaultFactory();
        growthVault = new DeepV3PermissionVault(manager);
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV2();
        hook = _deployHook();

        token = new DeepV3PermissionToken(address(this));
        token.mint(address(this), Policy.TOKEN_SUPPLY);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(modifyLiquidityNoChecks), type(uint256).max);
        token.approve(address(donateRouter), type(uint256).max);

        deepKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: Policy.LP_FEE_PIPS,
            tickSpacing: Policy.TICK_SPACING,
            hooks: hook
        });
        poolId = PoolId.unwrap(deepKey.toId());
        vaultFactory.register(address(growthVault), address(hook), poolId, address(token));
        assertEq(hook.registerPool(deepKey, address(growthVault)), poolId);
        assertEq(manager.initialize(deepKey, Policy.initialSqrtPriceX96()), Policy.INITIAL_TICK);
    }

    function test_hookPermissionBitmapIsExact() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.afterInitialize);
        assertTrue(permissions.beforeAddLiquidity);
        assertTrue(permissions.beforeRemoveLiquidity);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeDonate);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.afterDonate);
    }

    function test_factoryPredictionProvenanceAndReplayProtection() public {
        address predicted = hookFactory.predict(
            hookSalt,
            manager,
            treasury,
            vaultFactory,
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
        assertEq(predicted, address(hook));
        assertNotEq(hookFactory.configurationHashOf(address(hook)), bytes32(0));
        assertEq(uint160(address(hook)) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFeeOracleHookFactoryV2.HookAlreadyDeployed.selector, address(hook))
        );
        hookFactory.deploy(
            hookSalt,
            manager,
            treasury,
            vaultFactory,
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
    }

    function test_factoryRejectsWrongPermissionBitmap() public {
        bytes32 wrongSalt = bytes32(uint256(hookSalt) + 1);
        address predicted = hookFactory.predict(
            wrongSalt,
            manager,
            treasury,
            vaultFactory,
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
        uint160 actualFlags = uint160(predicted) & hookFactory.ALL_HOOK_MASK();
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFeeOracleHookFactoryV2.InvalidHookAddress.selector,
                predicted,
                actualFlags,
                hookFactory.REQUIRED_HOOK_FLAGS()
            )
        );
        hookFactory.deploy(
            wrongSalt,
            manager,
            treasury,
            vaultFactory,
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
    }

    function test_factoryRejectsEveryNonCanonicalOracleTickLimit() public {
        int24[3] memory invalidLimits =
            [Policy.MAX_ABS_OBSERVATION_TICK_DELTA - 1, Policy.MAX_ABS_OBSERVATION_TICK_DELTA + 1, TickMath.MAX_TICK];

        for (uint256 index; index < invalidLimits.length; ++index) {
            int24 invalidLimit = invalidLimits[index];
            bytes memory constructorArgs = abi.encode(
                manager,
                treasury,
                ILiquidityGrowthFullRangeVaultFactoryV3(address(vaultFactory)),
                IPositionManager(address(modifyLiquidityRouter)),
                invalidLimit
            );
            (, bytes32 invalidSalt) = HookMiner.find(
                address(hookFactory),
                hookFactory.REQUIRED_HOOK_FLAGS(),
                type(LiquidityGrowthFeeOracleHookV2).creationCode,
                constructorArgs
            );

            vm.expectRevert();
            hookFactory.deploy(
                invalidSalt,
                manager,
                treasury,
                vaultFactory,
                IPositionManager(address(modifyLiquidityRouter)),
                invalidLimit
            );
        }
    }

    function test_registerPoolRejectsFactoryVaultBoundToDifferentPool() public {
        DeepV3PermissionToken otherToken = new DeepV3PermissionToken(address(this));
        DeepV3PermissionVault otherVault = new DeepV3PermissionVault(manager);
        PoolKey memory otherKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(otherToken)),
            fee: Policy.LP_FEE_PIPS,
            tickSpacing: Policy.TICK_SPACING,
            hooks: hook
        });

        vaultFactory.register(address(otherVault), address(hook), poolId, address(token));

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFeeOracleHookV2.InvalidVault.selector, address(otherVault))
        );
        hook.registerPool(otherKey, address(otherVault));
    }

    function test_zeroBootstrapSaltRevertsWithoutAdvancingLifecycle() public {
        bytes32 bootstrapTag = hook.BOOTSTRAP_DOMAIN_TAG();
        vm.expectRevert();
        _bootstrapWithSalt(bytes32(0), bootstrapTag);

        (,, uint8 lifecycle,) = hook.poolFeeConfig(poolId);
        assertEq(lifecycle, hook.LIFECYCLE_INITIALIZED());
        assertEq(hook.initialPositionSaltByPool(poolId), bytes32(0));
    }

    function test_initialBuyBelowMinimumRevertsWithoutAdvancingLifecycle() public {
        _bootstrap();
        uint256 insufficientInitialBuy = Policy.MIN_INITIAL_BUY_WEI - 1;

        vm.expectRevert();
        manager.unlock(abi.encode(insufficientInitialBuy));

        (,, uint8 lifecycle,) = hook.poolFeeConfig(poolId);
        assertEq(lifecycle, hook.LIFECYCLE_INITIAL_POSITION_ADDED());
    }

    function test_onlyOneCanonicalBootstrapPositionCanBeAdded() public {
        _bootstrap();
        (,, uint8 lifecycle,) = hook.poolFeeConfig(poolId);
        assertEq(lifecycle, hook.LIFECYCLE_INITIAL_POSITION_ADDED());
        bytes32 bootstrapTag = hook.BOOTSTRAP_DOMAIN_TAG();

        vm.expectRevert();
        _bootstrapWithTag(bootstrapTag);
    }

    function test_arbitraryLiquidityRemovalAndDonationAlwaysRevert() public {
        _bootstrap();
        bytes32 bootstrapTag = hook.BOOTSTRAP_DOMAIN_TAG();

        vm.expectRevert();
        modifyLiquidityRouter.modifyLiquidity(
            deepKey,
            ModifyLiquidityParams({
                tickLower: Policy.FULL_RANGE_TICK_LOWER,
                tickUpper: Policy.INITIAL_TICK,
                liquidityDelta: -int256(1 ether),
                salt: bytes32(uint256(1))
            }),
            abi.encode(bootstrapTag)
        );

        vm.expectRevert();
        donateRouter.donate{ value: 1 }(deepKey, 1, 0, "");
    }

    function test_ordinarySwapBlockedUntilInitialBuyAndFinalize() public {
        _bootstrap();
        vm.expectRevert();
        swapRouter.swap{ value: 0.01 ether }(
            deepKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
    }

    function test_launcherBuyThenFinalizationStartsOracleAtPostBuyTick() public {
        _bootstrap();
        (, int24 beforeTick,,) = manager.getSlot0(PoolId.wrap(poolId));
        _initialBuy();
        (, int24 postBuyTick,,) = manager.getSlot0(PoolId.wrap(poolId));
        assertLt(postBuyTick, beforeTick);

        hook.finalizePool(deepKey);
        (uint32 timestamp, int24 previousTruncatedTick,,, bool initialized) =
            hook.observationsById(PoolId.wrap(poolId), 0);
        assertTrue(initialized);
        assertEq(timestamp, uint32(block.timestamp));
        assertEq(previousTruncatedTick, postBuyTick);
        (,, uint8 lifecycle,) = hook.poolFeeConfig(poolId);
        assertEq(lifecycle, hook.LIFECYCLE_FINALIZED());
    }

    function test_onlyBoundVaultCanArmAndNestedArmReverts() public {
        _completeLaunch();
        bytes32 digest = keccak256("deep-permission-intent");

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthFeeOracleHookV2.UnauthorizedFeeClaim.selector, address(this), address(growthVault)
            )
        );
        hook.armCompound(poolId, digest);

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthFeeOracleHookV2.CompoundIntentAlreadyArmed.selector, poolId)
        );
        growthVault.armTwice(hook, poolId, digest);
    }

    function test_internalCompoundRequiresDirectionModeTagAndDigest() public {
        _completeLaunch();
        bytes32 digest = keccak256("deep-permission-fields");
        bytes32 compoundTag = hook.COMPOUND_DOMAIN_TAG();

        vm.expectRevert();
        growthVault.attemptInternalSwap(hook, poolId, deepKey, digest, digest, compoundTag, false, -int256(0.001 ether));

        vm.expectRevert();
        growthVault.attemptInternalSwap(hook, poolId, deepKey, digest, digest, compoundTag, true, int256(0.001 ether));

        vm.expectRevert();
        growthVault.attemptInternalSwap(
            hook, poolId, deepKey, digest, digest, keccak256("wrong-tag"), true, -int256(0.001 ether)
        );

        vm.expectRevert();
        growthVault.attemptInternalSwap(
            hook, poolId, deepKey, digest, keccak256("wrong-digest"), compoundTag, true, -int256(0.001 ether)
        );
    }

    function test_internalCompoundWalksLifecycleWithoutChargingFees() public {
        _completeLaunch();
        vm.deal(address(growthVault), 1 ether);
        bytes32 digest = keccak256("deep-valid-compound");
        uint256 growthBefore;
        (,,, growthBefore) = hook.poolFeeConfig(poolId);
        uint256 programmableBefore = hook.launcherFeesAccrued();

        growthVault.compound(hook, deepKey, digest, 0.001 ether);

        assertEq(growthVault.stateAfterSwap(), Policy.INTENT_SWAPPED);
        assertEq(growthVault.digestAfterSwap(), digest);
        assertEq(growthVault.stateAfterAdd(), Policy.INTENT_ADDED);
        assertEq(growthVault.digestAfterAdd(), digest);
        (uint8 state, bytes32 storedDigest) = hook.compoundIntentState(poolId);
        assertEq(state, Policy.INTENT_EMPTY);
        assertEq(storedDigest, bytes32(0));
        (,,, uint256 growthAfter) = hook.poolFeeConfig(poolId);
        assertEq(growthAfter, growthBefore);
        assertEq(hook.launcherFeesAccrued(), programmableBefore);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        assertEq(msg.sender, address(manager));
        uint256 nativeAmount = abi.decode(data, (uint256));
        BalanceDelta delta = manager.swap(
            deepKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(nativeAmount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            abi.encode(hook.LAUNCH_BUY_DOMAIN_TAG())
        );
        NATIVE.settle(manager, address(this), nativeAmount, false);
        deepKey.currency1.take(manager, address(this), uint256(int256(delta.amount1())), false);
        return "";
    }

    function _deployHook() private returns (LiquidityGrowthFeeOracleHookV2 deployed) {
        bytes memory constructorArgs = abi.encode(
            manager,
            treasury,
            ILiquidityGrowthFullRangeVaultFactoryV3(address(vaultFactory)),
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
        (, hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV2).creationCode,
            constructorArgs
        );
        deployed = hookFactory.deploy(
            hookSalt,
            manager,
            treasury,
            vaultFactory,
            IPositionManager(address(modifyLiquidityRouter)),
            Policy.MAX_ABS_OBSERVATION_TICK_DELTA
        );
    }

    function _bootstrap() private {
        _bootstrapWithTag(hook.BOOTSTRAP_DOMAIN_TAG());
    }

    function _bootstrapWithTag(bytes32 bootstrapTag) private {
        _bootstrapWithSalt(bytes32(uint256(1)), bootstrapTag);
    }

    function _bootstrapWithSalt(bytes32 salt, bytes32 bootstrapTag) private {
        modifyLiquidityRouter.modifyLiquidity(
            deepKey,
            ModifyLiquidityParams({
                tickLower: Policy.FULL_RANGE_TICK_LOWER,
                tickUpper: Policy.INITIAL_TICK,
                liquidityDelta: int256(1000 ether),
                salt: salt
            }),
            abi.encode(bootstrapTag)
        );
    }

    function _initialBuy() private {
        manager.unlock(abi.encode(INITIAL_BUY));
    }

    function _completeLaunch() private {
        _bootstrap();
        _initialBuy();
        hook.finalizePool(deepKey);
    }
}
