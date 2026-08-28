// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { EthCreatorFeeHookFactoryV4 } from "../src/EthCreatorFeeHookFactoryV4.sol";
import { EthCreatorFeeHookV4 } from "../src/EthCreatorFeeHookV4.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";

contract ClassicV4CreatorToken is MockERC20 {
    address public immutable creator;

    constructor(address creator_) MockERC20("Classic V4", "CV4", 18) {
        creator = creator_;
    }
}

contract RejectingPayout {
    receive() external payable {
        revert();
    }
}

contract EthCreatorFeeHookV4Test is Deployers {
    uint16 internal constant BUY_FEE_BPS = 200;
    uint16 internal constant SELL_FEE_BPS = 700;
    uint256 internal constant BASIS_POINTS = 10_000;

    EthCreatorFeeHookFactoryV4 internal hookFactory;
    FeeSplitVaultFactoryV1 internal vaultFactory;
    EthCreatorFeeHookV4 internal hook;
    FeeSplitVaultV1 internal vault;
    ClassicV4CreatorToken internal token;
    PoolKey internal hookKey;
    bytes32 internal poolId;
    bytes32 internal hookSalt;

    address internal treasury;
    address internal alice;
    address internal bob;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1000 ether);

        treasury = makeAddr("programmableTreasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        vaultFactory = new FeeSplitVaultFactoryV1();
        hookFactory = new EthCreatorFeeHookFactoryV4();
        hook = _deployHook();

        token = new ClassicV4CreatorToken(address(this));
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        poolId = PoolId.unwrap(hookKey.toId());
        vault = _deployVault(poolId, _addresses2(alice, bob), _shares2(6000, 4000), bytes32("main"));
        assertEq(hook.registerPool(hookKey, address(vault), BUY_FEE_BPS, SELL_FEE_BPS), poolId);
        manager.initialize(hookKey, SQRT_PRICE_1_1);

        LIQUIDITY_PARAMS =
            ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 20 ether }(hookKey, LIQUIDITY_PARAMS, ZERO_BYTES);
    }

    function test_configurationAndDisclosureAreExplicit() public view {
        assertEq(hook.launcherFeeRecipient(), treasury);
        assertEq(address(hook.feeSplitVaultFactory()), address(vaultFactory));
        assertEq(hook.LAUNCHER_FEE_BPS(), 10);
        assertEq(hook.MIN_TOTAL_SWAP_FEE_BPS(), 10);
        assertEq(hook.MAX_TOTAL_SWAP_FEE_BPS(), 1000);
        assertEq(hook.TOTAL_SWAP_FEE_STEP_BPS(), 10);
        assertEq(hook.TRANSFER_TAX_BPS(), 0);
        assertEq(hook.LP_FEE_PIPS(), 0);
        assertEq(uint160(address(hook)) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());

        (
            uint16 buy,
            uint16 sell,
            uint16 buyCreator,
            uint16 sellCreator,
            uint16 platform,
            uint16 transferTax,
            uint24 lpFee,
            address rewardVault
        ) = hook.feeDisclosure(poolId);
        assertEq(buy, 200);
        assertEq(sell, 700);
        assertEq(buyCreator, 190);
        assertEq(sellCreator, 690);
        assertEq(platform, 10);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(rewardVault, address(vault));

        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
    }

    function test_buyExactInputUsesBuyFee() public {
        uint256 gross = 0.1 ether;
        BalanceDelta delta = _swap(true, -int256(gross), gross);
        (uint256 creatorFee, uint256 platformFee) = hook.quoteGrossFees(gross, BUY_FEE_BPS);

        assertEq(uint256(-int256(delta.amount0())), gross);
        _assertAccrued(creatorFee, platformFee);
    }

    function test_buyExactOutputUsesBuyFee() public {
        uint256 tokenOutput = 0.01 ether;
        BalanceDelta delta = _swap(true, int256(tokenOutput), 1 ether);
        uint256 creatorFee = _creatorAccrued();
        uint256 platformFee = hook.launcherFeesAccrued();
        uint256 grossNativeInput = uint256(-int256(delta.amount0()));
        uint256 netNativeInput = grossNativeInput - creatorFee - platformFee;
        (uint256 expectedCreator, uint256 expectedPlatform) = hook.quoteExactOutputFees(netNativeInput, BUY_FEE_BPS);

        assertEq(uint256(int256(delta.amount1())), tokenOutput);
        _assertAccrued(expectedCreator, expectedPlatform);
    }

    function test_sellExactInputUsesSellFee() public {
        uint256 tokenInput = 0.01 ether;
        BalanceDelta delta = _swap(false, -int256(tokenInput), 0);
        uint256 creatorFee = _creatorAccrued();
        uint256 platformFee = hook.launcherFeesAccrued();
        uint256 grossNativeOutput = uint256(int256(delta.amount0())) + creatorFee + platformFee;
        (uint256 expectedCreator, uint256 expectedPlatform) = hook.quoteGrossFees(grossNativeOutput, SELL_FEE_BPS);

        assertEq(uint256(-int256(delta.amount1())), tokenInput);
        _assertAccrued(expectedCreator, expectedPlatform);
    }

    function test_sellExactOutputUsesSellFee() public {
        uint256 netNativeOutput = 0.005 ether;
        BalanceDelta delta = _swap(false, int256(netNativeOutput), 0);
        (uint256 creatorFee, uint256 platformFee) = hook.quoteExactOutputFees(netNativeOutput, SELL_FEE_BPS);

        assertEq(uint256(int256(delta.amount0())), netNativeOutput);
        _assertAccrued(creatorFee, platformFee);
    }

    function test_platformShareIsAlwaysTenBpsAndNotAddedOnTop() public view {
        for (uint16 fee = 10; fee <= 1000; fee += 10) {
            (uint256 creatorFee, uint256 platformFee) = hook.quoteGrossFees(1 ether, fee);
            assertEq(platformFee, 0.001 ether);
            assertEq(creatorFee + platformFee, uint256(fee) * 0.0001 ether);
            if (fee == hook.LAUNCHER_FEE_BPS()) assertEq(creatorFee, 0);
        }
    }

    function test_minimumFeeGrossQuotesRouteOnlyToPlatformAcrossRoundingBoundaries() public view {
        uint256[7] memory amounts = [uint256(0), 1, 999, 1000, 1001, 9999, 1 ether];
        for (uint256 index; index < amounts.length; index++) {
            (uint256 creatorFee, uint256 platformFee) = hook.quoteGrossFees(amounts[index], 10);
            assertEq(creatorFee, 0);
            assertEq(platformFee, FullMath.mulDiv(amounts[index], 10, BASIS_POINTS));
        }
    }

    function test_minimumFeeExactOutputQuotesRouteRoundingOnlyToPlatform() public view {
        uint256[8] memory amounts = [uint256(0), 1, 2, 999, 1000, 9990, 9991, 1 ether];
        for (uint256 index; index < amounts.length; index++) {
            uint256 gross = FullMath.mulDivRoundingUp(amounts[index], BASIS_POINTS, BASIS_POINTS - 10);
            (uint256 creatorFee, uint256 platformFee) = hook.quoteExactOutputFees(amounts[index], 10);
            assertEq(creatorFee, 0);
            assertEq(platformFee, gross - amounts[index]);
        }
    }

    function test_factoryPredictionFlagsAndProvenanceAreExact() public {
        address predicted = hookFactory.predict(hookSalt, manager, treasury, vaultFactory);
        assertEq(predicted, address(hook));
        assertEq(uint160(predicted) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());
        assertTrue(hookFactory.isFactoryHook(predicted));
        assertTrue(hookFactory.configurationHashOf(predicted) != bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(EthCreatorFeeHookFactoryV4.HookAlreadyDeployed.selector, predicted));
        hookFactory.deploy(hookSalt, manager, treasury, vaultFactory);
    }

    function test_minimumFeeBuyExactInputAccruesNoCreatorFee() public {
        (PoolKey memory key, bytes32 id,) = _deployMinimumFeePool(bytes32("minimum-buy-exact-input"));
        uint256 gross = 0.1 ether;
        BalanceDelta delta = _swapKey(key, true, -int256(gross), gross);
        (uint256 creatorFee, uint256 platformFee) = hook.quoteGrossFees(gross, 10);

        assertEq(uint256(-int256(delta.amount0())), gross);
        assertEq(creatorFee, 0);
        _assertPlatformOnly(id, platformFee);
    }

    function test_minimumFeeBuyExactOutputAccruesNoCreatorFee() public {
        (PoolKey memory key, bytes32 id,) = _deployMinimumFeePool(bytes32("minimum-buy-exact-output"));
        uint256 tokenOutput = 0.01 ether;
        BalanceDelta delta = _swapKey(key, true, int256(tokenOutput), 1 ether);
        uint256 platformFee = hook.launcherFeesAccrued();
        uint256 grossNativeInput = uint256(-int256(delta.amount0()));
        uint256 netNativeInput = grossNativeInput - platformFee;
        (uint256 expectedCreator, uint256 expectedPlatform) = hook.quoteExactOutputFees(netNativeInput, 10);

        assertEq(uint256(int256(delta.amount1())), tokenOutput);
        assertEq(expectedCreator, 0);
        _assertPlatformOnly(id, expectedPlatform);
    }

    function test_minimumFeeSellExactInputAccruesNoCreatorFee() public {
        (PoolKey memory key, bytes32 id,) = _deployMinimumFeePool(bytes32("minimum-sell-exact-input"));
        uint256 tokenInput = 0.01 ether;
        BalanceDelta delta = _swapKey(key, false, -int256(tokenInput), 0);
        uint256 platformFee = hook.launcherFeesAccrued();
        uint256 grossNativeOutput = uint256(int256(delta.amount0())) + platformFee;
        (uint256 expectedCreator, uint256 expectedPlatform) = hook.quoteGrossFees(grossNativeOutput, 10);

        assertEq(uint256(-int256(delta.amount1())), tokenInput);
        assertEq(expectedCreator, 0);
        _assertPlatformOnly(id, expectedPlatform);
    }

    function test_minimumFeeSellExactOutputAccruesNoCreatorFee() public {
        (PoolKey memory key, bytes32 id,) = _deployMinimumFeePool(bytes32("minimum-sell-exact-output"));
        uint256 netNativeOutput = 0.005 ether;
        BalanceDelta delta = _swapKey(key, false, int256(netNativeOutput), 0);
        (uint256 creatorFee, uint256 platformFee) = hook.quoteExactOutputFees(netNativeOutput, 10);

        assertEq(uint256(int256(delta.amount0())), netNativeOutput);
        assertEq(creatorFee, 0);
        _assertPlatformOnly(id, platformFee);
    }

    function test_minimumFeeVaultPullIsAZeroValueNoOp() public {
        (PoolKey memory key, bytes32 id, FeeSplitVaultV1 minimumVault) =
            _deployMinimumFeePool(bytes32("minimum-zero-creator-claim"));
        _swapKey(key, true, -int256(0.1 ether), 0.1 ether);
        uint256 platformFee = hook.launcherFeesAccrued();

        vm.prank(address(minimumVault));
        assertEq(hook.claimCreatorFees(id), 0);
        _assertPlatformOnly(id, platformFee);
    }

    function test_rejectsInvalidBuyAndSellFees() public {
        uint16[9] memory invalid = [uint16(0), 1, 9, 11, 19, 111, 999, 1001, 1010];
        for (uint256 index; index < invalid.length; index++) {
            ClassicV4CreatorToken candidateToken = new ClassicV4CreatorToken(address(this));
            PoolKey memory candidate = _candidateKey(address(candidateToken));
            bytes32 candidateId = PoolId.unwrap(candidate.toId());
            FeeSplitVaultV1 candidateVault =
                _deployVault(candidateId, _addresses1(alice), _shares1(10_000), bytes32(index + 1));

            vm.expectRevert(abi.encodeWithSelector(EthCreatorFeeHookV4.InvalidTotalSwapFee.selector, invalid[index]));
            hook.registerPool(candidate, address(candidateVault), invalid[index], 10);

            vm.expectRevert(abi.encodeWithSelector(EthCreatorFeeHookV4.InvalidTotalSwapFee.selector, invalid[index]));
            hook.registerPool(candidate, address(candidateVault), 10, invalid[index]);
        }
    }

    function test_acceptsIndependentPointOnePercentSteps() public {
        ClassicV4CreatorToken candidateToken = new ClassicV4CreatorToken(address(this));
        PoolKey memory candidate = _candidateKey(address(candidateToken));
        bytes32 candidateId = PoolId.unwrap(candidate.toId());
        FeeSplitVaultV1 candidateVault =
            _deployVault(candidateId, _addresses1(alice), _shares1(10_000), bytes32("fee-step"));

        hook.registerPool(candidate, address(candidateVault), 110, 370);
        (,, uint16 buyFeeBps, uint16 sellFeeBps, bool registered,) = hook.poolFeeConfig(candidateId);
        assertTrue(registered);
        assertEq(buyFeeBps, 110);
        assertEq(sellFeeBps, 370);
    }

    function test_acceptsIndependentPointOneAndTenPercentFeeBounds() public {
        ClassicV4CreatorToken candidateToken = new ClassicV4CreatorToken(address(this));
        PoolKey memory candidate = _candidateKey(address(candidateToken));
        bytes32 candidateId = PoolId.unwrap(candidate.toId());
        FeeSplitVaultV1 candidateVault =
            _deployVault(candidateId, _addresses1(alice), _shares1(10_000), bytes32("fee-bounds"));

        hook.registerPool(candidate, address(candidateVault), 10, 1000);
        (,, uint16 buyFeeBps, uint16 sellFeeBps, bool registered,) = hook.poolFeeConfig(candidateId);
        assertTrue(registered);
        assertEq(buyFeeBps, 10);
        assertEq(sellFeeBps, 1000);

        (uint16 buy, uint16 sell, uint16 buyCreator, uint16 sellCreator, uint16 platform,,,) =
            hook.feeDisclosure(candidateId);
        assertEq(buy, 10);
        assertEq(sell, 1000);
        assertEq(buyCreator, 0);
        assertEq(sellCreator, 990);
        assertEq(platform, 10);
    }

    function test_onlyVaultCanPullCreatorFeesAndOnlyBeneficiaryCanClaim() public {
        _swap(true, -int256(0.1 ether), 0.1 ether);
        address attacker = makeAddr("attacker");

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(EthCreatorFeeHookV4.UnauthorizedCreatorClaim.selector, attacker, address(vault))
        );
        hook.claimCreatorFees(poolId);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(FeeSplitVaultV1.UnauthorizedBeneficiary.selector, attacker));
        vault.claim();
    }

    function test_splitClaimsConserveAllCreatorFees() public {
        _swap(true, -int256(0.1 ether), 0.1 ether);
        uint256 creatorFee = _creatorAccrued();

        vm.prank(alice);
        uint256 aliceClaim = vault.claim();
        vm.prank(bob);
        uint256 bobClaim = vault.claim();

        assertEq(aliceClaim, FullMath.mulDiv(creatorFee, 6000, BASIS_POINTS));
        assertEq(aliceClaim + bobClaim, creatorFee);
        assertEq(alice.balance, aliceClaim);
        assertEq(bob.balance, bobClaim);
        assertEq(vault.totalCreatorFeesClaimed(), creatorFee);
    }

    function test_addressChangeRedirectsExistingAndFutureRewardsWithoutMovingAuthority() public {
        _swap(true, -int256(0.1 ether), 0.1 ether);
        address destination = makeAddr("destination");

        vm.prank(alice);
        vault.setPayoutAddress(destination);
        vm.prank(alice);
        uint256 first = vault.claim();
        _swap(false, -int256(0.01 ether), 0);
        vm.prank(alice);
        uint256 second = vault.claim();

        assertEq(destination.balance, first + second);
        vm.prank(destination);
        vm.expectRevert(abi.encodeWithSelector(FeeSplitVaultV1.UnauthorizedBeneficiary.selector, destination));
        vault.claim();
    }

    function test_duplicatePayoutDestinationsAreAllowed() public {
        address destination = makeAddr("sharedDestination");
        vm.prank(alice);
        vault.setPayoutAddress(destination);
        vm.prank(bob);
        vault.setPayoutAddress(destination);
        _swap(true, -int256(0.1 ether), 0.1 ether);
        uint256 creatorFee = _creatorAccrued();

        vm.prank(alice);
        vault.claim();
        vm.prank(bob);
        vault.claim();
        assertEq(destination.balance, creatorFee);
    }

    function test_revertingPayoutDoesNotBlockAnotherBeneficiary() public {
        RejectingPayout rejecting = new RejectingPayout();
        vm.prank(alice);
        vault.setPayoutAddress(address(rejecting));
        _swap(true, -int256(0.1 ether), 0.1 ether);

        vm.prank(alice);
        vm.expectRevert();
        vault.claim();

        vm.prank(bob);
        uint256 bobClaim = vault.claim();
        assertGt(bobClaim, 0);
        assertEq(bob.balance, bobClaim);
    }

    function test_noDoubleClaimAndNoCrossBeneficiaryClaim() public {
        _swap(true, -int256(0.1 ether), 0.1 ether);
        vm.prank(alice);
        vault.claim();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FeeSplitVaultV1.NoFeesToClaim.selector, alice));
        vault.claim();

        FeeSplitVaultV1 otherVault =
            _deployVault(bytes32("other-pool"), _addresses1(bob), _shares1(10_000), bytes32("other"));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FeeSplitVaultV1.UnauthorizedBeneficiary.selector, alice));
        otherVault.claim();
    }

    function test_onlyTreasuryCanClaimOrRedirectPlatformFees() public {
        _swap(true, -int256(0.1 ether), 0.1 ether);
        address attacker = makeAddr("platformAttacker");
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(EthCreatorFeeHookV4.UnauthorizedFeeRedirect.selector, attacker, treasury)
        );
        hook.claimLauncherFees();

        address recipient = makeAddr("treasuryRecipient");
        uint256 accrued = hook.launcherFeesAccrued();
        vm.prank(treasury);
        hook.claimLauncherFeesTo(recipient);
        assertEq(recipient.balance, accrued);
    }

    function test_onlyPoolManagerCanCallEnabledHookCallbacksAndUnlockCallback() public {
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), hookKey, SQRT_PRICE_1_1);

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), hookKey, params, "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), hookKey, params, BalanceDelta.wrap(0), "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.unlockCallback("");
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_feeQuotesPreserveFixedEconomics(uint96 rawGross, uint8 rawStep) public view {
        uint256 gross = bound(uint256(rawGross), 10_000, 100_000 ether);
        uint16 totalFeeBps = uint16(bound(uint256(rawStep), 1, 100) * 10);
        (uint256 creatorFee, uint256 platformFee) = hook.quoteGrossFees(gross, totalFeeBps);
        assertEq(creatorFee + platformFee, FullMath.mulDiv(gross, totalFeeBps, BASIS_POINTS));
        assertEq(platformFee, FullMath.mulDiv(gross, 10, BASIS_POINTS));
        if (totalFeeBps == hook.LAUNCHER_FEE_BPS()) assertEq(creatorFee, 0);
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_minimumFeeQuotesNeverAccrueCreator(uint128 rawGross, uint128 rawNet) public view {
        uint256 gross = uint256(rawGross);
        (uint256 grossCreator, uint256 grossPlatform) = hook.quoteGrossFees(gross, 10);
        assertEq(grossCreator, 0);
        assertEq(grossPlatform, FullMath.mulDiv(gross, 10, BASIS_POINTS));

        uint256 net = uint256(rawNet);
        uint256 exactOutputGross = FullMath.mulDivRoundingUp(net, BASIS_POINTS, BASIS_POINTS - 10);
        (uint256 netCreator, uint256 netPlatform) = hook.quoteExactOutputFees(net, 10);
        assertEq(netCreator, 0);
        assertEq(netPlatform, exactOutputGross - net);
    }

    function _deployHook() private returns (EthCreatorFeeHookV4 deployed) {
        (, hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV4).creationCode,
            abi.encode(manager, treasury, vaultFactory)
        );
        deployed = hookFactory.deploy(hookSalt, manager, treasury, vaultFactory);
    }

    function _deployVault(bytes32 id, address[] memory beneficiaries, uint16[] memory shares, bytes32 salt)
        private
        returns (FeeSplitVaultV1)
    {
        return vaultFactory.deploy(salt, IClassicFeeHookV3(address(hook)), id, beneficiaries, shares);
    }

    function _candidateKey(address candidateToken) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(candidateToken),
            fee: 0,
            tickSpacing: 200,
            hooks: hook
        });
    }

    function _deployMinimumFeePool(bytes32 salt)
        private
        returns (PoolKey memory key, bytes32 id, FeeSplitVaultV1 minimumVault)
    {
        ClassicV4CreatorToken minimumToken = new ClassicV4CreatorToken(address(this));
        minimumToken.mint(address(this), 1_000_000 ether);
        minimumToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        minimumToken.approve(address(swapRouter), type(uint256).max);

        key = _candidateKey(address(minimumToken));
        id = PoolId.unwrap(key.toId());
        minimumVault = _deployVault(id, _addresses1(alice), _shares1(10_000), salt);
        assertEq(hook.registerPool(key, address(minimumVault), 10, 10), id);
        manager.initialize(key, SQRT_PRICE_1_1);

        ModifyLiquidityParams memory parameters =
            ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 20 ether }(key, parameters, ZERO_BYTES);
    }

    function _swap(bool zeroForOne, int256 amountSpecified, uint256 value) private returns (BalanceDelta) {
        return _swapKey(hookKey, zeroForOne, amountSpecified, value);
    }

    function _swapKey(PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint256 value)
        private
        returns (BalanceDelta)
    {
        return swapRouter.swap{ value: value }(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            settings,
            ""
        );
    }

    function _creatorAccrued() private view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(poolId);
    }

    function _assertAccrued(uint256 creatorFee, uint256 platformFee) private view {
        assertEq(_creatorAccrued(), creatorFee);
        assertEq(hook.launcherFeesAccrued(), platformFee);
        assertEq(hook.totalNativeFeesAccrued(), creatorFee + platformFee);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), creatorFee + platformFee);
    }

    function _assertPlatformOnly(bytes32 id, uint256 platformFee) private view {
        (,,,,, uint256 creatorFee) = hook.poolFeeConfig(id);
        assertEq(creatorFee, 0);
        assertEq(hook.launcherFeesAccrued(), platformFee);
        assertEq(hook.totalNativeFeesAccrued(), platformFee);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), platformFee);
    }

    function _addresses1(address a) private pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = a;
    }

    function _shares1(uint16 a) private pure returns (uint16[] memory values) {
        values = new uint16[](1);
        values[0] = a;
    }

    function _addresses2(address a, address b) private pure returns (address[] memory values) {
        values = new address[](2);
        values[0] = a;
        values[1] = b;
    }

    function _shares2(uint16 a, uint16 b) private pure returns (uint16[] memory values) {
        values = new uint16[](2);
        values[0] = a;
        values[1] = b;
    }
}
