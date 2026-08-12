// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";

import { ProgrammableVolumeFeeHookFactoryV2 } from "../src/ProgrammableVolumeFeeHookFactoryV2.sol";
import { ProgrammableVolumeFeeHookV2 } from "../src/ProgrammableVolumeFeeHookV2.sol";
import { MockReferenceToken } from "./MockReferenceToken.sol";

contract ReentrantNativeClaimRecipient {
    ProgrammableVolumeFeeHookV2 public immutable hook;
    bool public attempted;
    bool public reentrySucceeded;
    bytes4 public reentryRevertSelector;

    constructor(ProgrammableVolumeFeeHookV2 hook_) {
        hook = hook_;
    }

    receive() external payable {
        attempted = true;
        try hook.claimProgrammableFees(address(this)) returns (uint256) {
            reentrySucceeded = true;
        } catch (bytes memory reason) {
            if (reason.length >= 4) {
                // ABI revert data starts with a left-aligned four-byte selector. The length check makes this
                // memory load safe and avoids a truncating high-level bytes-to-bytes4 cast.
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(reason, 0x20))
                }
                reentryRevertSelector = selector;
            }
        }
    }
}

contract ProgrammableVolumeFeeHookV2Test is Deployers {
    using SafeCast for uint256;

    event ProgrammableVolumeFeeHookDeployedAndRegistered(
        address indexed hook,
        address indexed poolManager,
        bytes32 indexed poolId,
        bytes32 userSalt,
        bytes32 effectiveSalt,
        bytes32 registrationConfigHash,
        bytes32 runtimeConfigurationHash,
        bytes32 factoryConfigurationHash
    );
    event ProgrammableVolumeFeeHookDeploymentReconciled(
        address indexed hook,
        address indexed poolManager,
        bytes32 indexed poolId,
        bytes32 userSalt,
        bytes32 effectiveSalt,
        bytes32 registrationConfigHash,
        bytes32 runtimeConfigurationHash,
        bytes32 factoryConfigurationHash
    );

    uint24 internal constant LP_FEE_PIPS = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint32 internal constant SELECTED_THREE_PERCENT = 30_000;

    ProgrammableVolumeFeeHookFactoryV2 internal hookFactory;
    ProgrammableVolumeFeeHookV2 internal hook;
    MockReferenceToken internal projectToken;
    PoolKey internal hookKey;
    bytes32 internal poolId;

    address internal projectFeeOwner = makeAddr("projectFeeOwner");
    address internal attacker = makeAddr("attacker");
    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 10_000 ether);

        hookFactory = new ProgrammableVolumeFeeHookFactoryV2();
        projectToken = new MockReferenceToken("Reference Project", "RPROJ");
        projectToken.mint(address(this), 1_000_000 ether);
        projectToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        projectToken.approve(address(swapRouter), type(uint256).max);

        hook = _deployAndRegisterHook(
            address(0),
            CurrencyLibrary.ADDRESS_ZERO,
            Currency.wrap(address(projectToken)),
            LP_FEE_PIPS,
            TICK_SPACING,
            projectFeeOwner,
            SELECTED_THREE_PERCENT,
            SELECTED_THREE_PERCENT,
            SQRT_PRICE_1_1
        );

        hookKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(projectToken)),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
        poolId = PoolId.unwrap(hookKey.toId());
        ModifyLiquidityParams memory liquidity =
            ModifyLiquidityParams({ tickLower: -120, tickUpper: 120, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(hookKey, liquidity, ZERO_BYTES);
    }

    function testPolicyIdentityAndHighRateBoundary() public {
        assertEq(hook.PROGRAMMABLE_FEE_OWNER(), 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c);
        assertEq(hook.PROGRAMMABLE_FEE_POLICY_HASH(), keccak256("programmable-volume-fee-v2@2.0.0"));
        assertEq(hook.COLLECTION_PROFILE_HASH(), keccak256("standard-amm"));
        assertEq(hook.MAX_SELECTED_HUNDREDTHS_OF_BIP(), 999_999);

        (uint256 total, uint256 project, uint256 programmable,,, bool ready) =
            hook.previewGrossFees(1_000_000, 999_999, 0, 0);
        assertEq(programmable, 1000);
        assertEq(project, 998_999);
        assertEq(total, 999_999);
        assertTrue(ready);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableVolumeFeeHookV2.InvalidSelectedTotalFee.selector, uint32(1_000_000))
        );
        hook.previewGrossFees(1_000_000, 1_000_000, 0, 0);
    }

    function testStaticLpFeeBoundaryMatchesV4ExactOutputRule() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig({
                poolManager: manager,
                currency0: CurrencyLibrary.ADDRESS_ZERO,
                currency1: Currency.wrap(address(projectToken)),
                lpFeePips: 1_000_000,
                tickSpacing: TICK_SPACING,
                quoteCurrency: address(projectToken),
                projectFeeOwner: projectFeeOwner,
                selectedBuyHundredthsOfBip: 0,
                selectedSellHundredthsOfBip: 0,
                initialSqrtPriceX96: SQRT_PRICE_1_1
            });
        (address predicted, bytes32 userSalt) = _mineHook(config);

        vm.expectRevert(abi.encodeWithSelector(ProgrammableVolumeFeeHookV2.InvalidLpFee.selector, uint24(1_000_000)));
        hookFactory.deployAndRegister(userSalt, config);
        assertEq(predicted.code.length, 0);
        assertEq(hookFactory.factoryConfigurationHashOf(predicted), bytes32(0));
        assertEq(hookFactory.runtimeConfigurationHashOf(predicted), bytes32(0));
        assertEq(hookFactory.registrationConfigHashOf(predicted), bytes32(0));
        assertEq(hookFactory.effectiveSaltOf(predicted), bytes32(0));

        config.lpFeePips = 999_999;
        (, userSalt) = _mineHook(config);
        (ProgrammableVolumeFeeHookV2 candidate,,,) = hookFactory.deployAndRegister(userSalt, config);
        PoolKey memory candidateKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(projectToken)),
            fee: 999_999,
            tickSpacing: TICK_SPACING,
            hooks: candidate
        });
        assertTrue(candidate.canonicalPoolRegistered());
        assertEq(candidate.canonicalPoolId(), PoolId.unwrap(candidateKey.toId()));
    }

    function testNoArtificialMinimumAndMicroBoundaryRoutesHonestly() public view {
        (uint256 tinyTotal,,,, uint256 tinyPlatformRemainder, bool tinyReady) = hook.previewGrossFees(1, 0, 0, 0);
        assertEq(tinyTotal, 0);
        assertEq(tinyPlatformRemainder, 1000);
        assertTrue(tinyReady);

        (uint256 total, uint256 project, uint256 programmable,,, bool ready) =
            hook.previewGrossFees(1, 100_000, 999_000, 901_000);
        assertEq(programmable, 1);
        assertEq(project, 1);
        assertEq(total, 2);
        assertFalse(ready);

        (uint256 feeOnly,,,,, bool feeOnlyReady) = hook.previewGrossFees(1, 500_000, 0, 501_000);
        assertEq(feeOnly, 1);
        assertFalse(feeOnlyReady);
    }

    function testFuzzSplitAndUnsplitHaveSameLifetimeEntitlement(uint96 rawFirst, uint96 rawSecond, uint32 rawSelected)
        public
        view
    {
        uint256 first = bound(uint256(rawFirst), 1, 1_000_000 ether);
        uint256 second = bound(uint256(rawSecond), 1, 1_000_000 ether);
        uint32 selected = uint32(bound(rawSelected, 0, hook.MAX_SELECTED_HUNDREDTHS_OF_BIP()));

        (
            uint256 firstTotal,
            uint256 firstProject,
            uint256 firstProgrammable,
            uint256 firstProjectRemainder,
            uint256 firstProgrammableRemainder,
        ) = hook.previewGrossFees(first, selected, 0, 0);
        (
            uint256 secondTotal,
            uint256 secondProject,
            uint256 secondProgrammable,
            uint256 splitProjectRemainder,
            uint256 splitProgrammableRemainder,
        ) = hook.previewGrossFees(second, selected, firstProgrammableRemainder, firstProjectRemainder);
        (
            uint256 wholeTotal,
            uint256 wholeProject,
            uint256 wholeProgrammable,
            uint256 wholeProjectRemainder,
            uint256 wholeProgrammableRemainder,
        ) = hook.previewGrossFees(first + second, selected, 0, 0);

        assertEq(firstTotal + secondTotal, wholeTotal);
        assertEq(firstProject + secondProject, wholeProject);
        assertEq(firstProgrammable + secondProgrammable, wholeProgrammable);
        assertEq(splitProjectRemainder, wholeProjectRemainder);
        assertEq(splitProgrammableRemainder, wholeProgrammableRemainder);
    }

    function testExactOutputWitnessAboveTenPercentAndForgeryRejection() public view {
        (bool valid, uint256 total, uint256 project, uint256 programmable,,) =
            hook.quoteExactOutputWitness(999, 9971, 900_000);
        assertTrue(valid);
        assertEq(9971 - total, 999);
        assertEq(total, project + programmable);

        (bool forged,,,,,) = hook.quoteExactOutputWitness(999, 9990, 900_000);
        assertFalse(forged);
    }

    function testActualExactInputAccruesOnlyFundedClaimTokens() public {
        uint256 gross = 1 ether;
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            hook.quoteGrossFees(gross, SELECTED_THREE_PERCENT);
        swapRouter.swap{ value: gross }(
            hookKey,
            SwapParams({ zeroForOne: true, amountSpecified: -gross.toInt256(), sqrtPriceLimitX96: MIN_PRICE_LIMIT }),
            settings,
            ZERO_BYTES
        );

        assertEq(hook.totalQuoteFeesAccrued(), expectedTotal);
        assertEq(hook.projectFeesAccrued(), expectedProject);
        assertEq(hook.programmableFeesAccrued(), expectedProgrammable);
        assertEq(expectedTotal, expectedProject + expectedProgrammable);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), expectedTotal);
    }

    function testUnspecifiedQuoteExactInputUsesExecutedGrossOutput() public {
        BalanceDelta delta = swapRouter.swap(
            hookKey,
            SwapParams({ zeroForOne: false, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: MAX_PRICE_LIMIT }),
            settings,
            ZERO_BYTES
        );
        uint256 total = hook.totalQuoteFeesAccrued();
        uint256 netQuoteOutput = uint256(int256(delta.amount0()));
        uint256 executedGrossQuoteOutput = netQuoteOutput + total;
        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            hook.previewGrossFees(executedGrossQuoteOutput, SELECTED_THREE_PERCENT, 0, 0);

        assertEq(total, expectedTotal);
        assertEq(hook.projectFeesAccrued(), expectedProject);
        assertEq(hook.programmableFeesAccrued(), expectedProgrammable);
    }

    function testUnspecifiedQuoteExactOutputUsesExecutedNetAndWitness() public {
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: int256(0.01 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });
        uint256 executedNetQuoteInput;
        try swapRouter.swap{ value: 1 ether }(hookKey, params, settings, abi.encode(uint256(1))) returns (
            BalanceDelta
        ) {
            fail();
        } catch (bytes memory reason) {
            (address target, bytes4 callbackSelector, bytes memory innerReason,) = this.decodeWrappedError(reason);
            assertEq(target, address(hook));
            assertEq(callbackSelector, IHooks.afterSwap.selector);
            uint256 rejectedWitness;
            (executedNetQuoteInput, rejectedWitness) = this.decodeInvalidWitness(innerReason);
            assertEq(rejectedWitness, 1);
        }

        uint256 grossQuoteWitness = _findThreePercentWitness(executedNetQuoteInput);
        BalanceDelta delta =
            swapRouter.swap{ value: grossQuoteWitness }(hookKey, params, settings, abi.encode(grossQuoteWitness));
        assertEq(uint256(-int256(delta.amount0())), grossQuoteWitness);

        (uint256 expectedTotal, uint256 expectedProject, uint256 expectedProgrammable,,,) =
            hook.previewGrossFees(grossQuoteWitness, SELECTED_THREE_PERCENT, 0, 0);
        assertEq(hook.totalQuoteFeesAccrued(), expectedTotal);
        assertEq(hook.projectFeesAccrued(), expectedProject);
        assertEq(hook.programmableFeesAccrued(), expectedProgrammable);
        assertEq(grossQuoteWitness - expectedTotal, executedNetQuoteInput);
    }

    function testSpecifiedQuoteExactOutputUsesGrossWitness() public {
        uint256 netQuoteOutput = 970_000;
        uint256 grossQuoteWitness = 1_000_000;
        BalanceDelta delta = swapRouter.swap(
            hookKey,
            SwapParams({
                zeroForOne: false, amountSpecified: netQuoteOutput.toInt256(), sqrtPriceLimitX96: MAX_PRICE_LIMIT
            }),
            settings,
            abi.encode(grossQuoteWitness)
        );

        assertEq(uint256(int256(delta.amount0())), netQuoteOutput);
        assertEq(hook.totalQuoteFeesAccrued(), 30_000);
        assertEq(hook.programmableFeesAccrued(), 1000);
        assertEq(hook.projectFeesAccrued(), 29_000);
    }

    function testExactOutputRequiresCurrentWitness() public {
        SwapParams memory params =
            SwapParams({ zeroForOne: false, amountSpecified: int256(970_000), sqrtPriceLimitX96: MAX_PRICE_LIMIT });
        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableVolumeFeeHookV2.InvalidHookDataLength.selector, uint256(0), uint256(32))
        );
        hook.beforeSwap(address(this), hookKey, params, ZERO_BYTES);

        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableVolumeFeeHookV2.InvalidExactOutputWitness.selector, uint256(970_000), uint256(999_999)
            )
        );
        hook.beforeSwap(address(this), hookKey, params, abi.encode(uint256(999_999)));
    }

    function testStaleWitnessFailsAfterRemaindersChange() public {
        (bool validBefore,,,,,) = hook.quoteExactOutputWitness(999, 1029, SELECTED_THREE_PERCENT);
        assertTrue(validBefore);
        swapRouter.swap{ value: 1999 }(
            hookKey,
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1999), sqrtPriceLimitX96: MIN_PRICE_LIMIT }),
            settings,
            ZERO_BYTES
        );
        (bool validAfter,,,,,) = hook.quoteExactOutputWitness(999, 1029, SELECTED_THREE_PERCENT);
        assertFalse(validAfter);
    }

    function testSpecifiedQuotePartialFillRevertsAllFeeState() public {
        vm.expectRevert();
        swapRouter.swap{ value: 100 ether }(
            hookKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(100 ether),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(-1)
            }),
            settings,
            ZERO_BYTES
        );
        assertEq(hook.totalQuoteFeesAccrued(), 0);
        assertEq(hook.programmableFeeRemainder(), 0);
        assertEq(hook.projectFeeRemainder(), 0);
    }

    function testOnlyExactOwnersCanClaimAndRemaindersSurvive() public {
        swapRouter.swap{ value: 1999 }(
            hookKey,
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1999), sqrtPriceLimitX96: MIN_PRICE_LIMIT }),
            settings,
            ZERO_BYTES
        );
        uint256 platformRemainder = hook.programmableFeeRemainder();
        uint256 projectRemainder = hook.projectFeeRemainder();
        address programmableOwner = hook.PROGRAMMABLE_FEE_OWNER();
        uint256 programmableBefore = hook.programmableFeesAccrued();
        assertGt(programmableBefore, 0);

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableVolumeFeeHookV2.UnauthorizedClaim.selector, attacker, programmableOwner)
        );
        hook.claimProgrammableFees(attacker);

        vm.prank(programmableOwner);
        vm.expectRevert(ProgrammableVolumeFeeHookV2.ZeroAddress.selector);
        hook.claimProgrammableFees(address(0));
        assertEq(hook.programmableFeesAccrued(), programmableBefore);

        address platformRecipient = makeAddr("platformRecipient");
        uint256 recipientBefore = platformRecipient.balance;
        vm.prank(programmableOwner);
        uint256 claimed = hook.claimProgrammableFees(platformRecipient);
        assertEq(claimed, programmableBefore);
        assertEq(platformRecipient.balance, recipientBefore + claimed);
        assertEq(hook.programmableFeeRemainder(), platformRemainder);
        assertEq(hook.projectFeeRemainder(), projectRemainder);
    }

    function testNativeClaimRecipientCannotReenterAnyClaimPath() public {
        swapRouter.swap{ value: 1999 }(
            hookKey,
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1999), sqrtPriceLimitX96: MIN_PRICE_LIMIT }),
            settings,
            ZERO_BYTES
        );
        uint256 programmableBefore = hook.programmableFeesAccrued();
        uint256 totalBefore = hook.totalQuoteFeesAccrued();
        uint256 projectBefore = hook.projectFeesAccrued();
        ReentrantNativeClaimRecipient recipient = new ReentrantNativeClaimRecipient(hook);

        vm.prank(hook.PROGRAMMABLE_FEE_OWNER());
        uint256 claimed = hook.claimProgrammableFees(address(recipient));

        assertEq(claimed, programmableBefore);
        assertEq(address(recipient).balance, claimed);
        assertTrue(recipient.attempted());
        assertFalse(recipient.reentrySucceeded());
        assertEq(recipient.reentryRevertSelector(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(hook.programmableFeesAccrued(), 0);
        assertEq(hook.projectFeesAccrued(), projectBefore);
        assertEq(hook.totalQuoteFeesAccrued(), totalBefore - claimed);
        assertEq(manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), projectBefore);
    }

    function testAlternatePoolCannotReuseScopeOrRemainders() public {
        PoolKey memory alternateKey = hookKey;
        alternateKey.fee = 500;
        bytes32 alternatePoolId = PoolId.unwrap(alternateKey.toId());
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });

        vm.prank(address(manager));
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableVolumeFeeHookV2.UnexpectedPool.selector, alternatePoolId, poolId)
        );
        hook.beforeSwap(address(this), alternateKey, params, ZERO_BYTES);
        assertEq(hook.totalQuoteFeesAccrued(), 0);
        assertEq(hook.projectFeeRemainder(), 0);
        assertEq(hook.programmableFeeRemainder(), 0);
    }

    function testHookAddressBitsAndOnePoolCurrencyScope() public view {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertEq(uint160(address(hook)) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());
        assertTrue(hookFactory.registrationConfigHashOf(address(hook)) != bytes32(0));
        assertTrue(hookFactory.effectiveSaltOf(address(hook)) != bytes32(0));
        assertTrue(hookFactory.factoryConfigurationHashOf(address(hook)) != bytes32(0));
        assertTrue(hook.runtimeConfigurationHash() != bytes32(0));
        assertEq(hookFactory.runtimeConfigurationHashOf(address(hook)), hook.runtimeConfigurationHash());
        assertEq(hook.claimableLiability(poolId, address(projectToken), hook.PROGRAMMABLE_FEE_OWNER()), 0);
    }

    function testFactoryConfigurationReceiptBindsFinalRuntimeConfiguration() public view {
        bytes32 expectedRuntimeHash = keccak256(
            abi.encode(
                hook.RUNTIME_CONFIGURATION_DOMAIN(),
                block.chainid,
                address(hook),
                address(manager),
                address(hookFactory),
                address(0),
                hook.PROGRAMMABLE_FEE_OWNER(),
                hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(),
                hook.PROGRAMMABLE_FEE_POLICY_HASH(),
                hook.COLLECTION_PROFILE_HASH(),
                poolId,
                Currency.unwrap(hookKey.currency0),
                Currency.unwrap(hookKey.currency1),
                true,
                LP_FEE_PIPS,
                TICK_SPACING,
                SQRT_PRICE_1_1,
                int24(0),
                projectFeeOwner,
                SELECTED_THREE_PERCENT,
                SELECTED_THREE_PERCENT,
                SELECTED_THREE_PERCENT,
                SELECTED_THREE_PERCENT
            )
        );
        assertEq(hook.runtimeConfigurationHash(), expectedRuntimeHash);
        assertEq(hookFactory.runtimeConfigurationHashOf(address(hook)), expectedRuntimeHash);
        bytes32 expectedFactoryHash = keccak256(
            abi.encode(
                hookFactory.FACTORY_CONFIGURATION_DOMAIN(),
                block.chainid,
                address(hookFactory),
                address(hook),
                expectedRuntimeHash
            )
        );
        assertEq(hookFactory.factoryConfigurationHashOf(address(hook)), expectedFactoryHash);
        assertEq(hook.canonicalCurrency0Address(), Currency.unwrap(hookKey.currency0));
        assertEq(hook.canonicalCurrency1Address(), Currency.unwrap(hookKey.currency1));
        assertEq(hook.canonicalPoolLpFeePips(), LP_FEE_PIPS);
        assertEq(hook.canonicalPoolTickSpacing(), TICK_SPACING);
        assertEq(hook.canonicalPoolInitialSqrtPriceX96(), SQRT_PRICE_1_1);
        assertEq(hook.canonicalPoolInitialTick(), 0);
        assertTrue(hook.runtimeConfigurationFinalized());
    }

    function testEveryRegistrationConfigFieldChangesCommitmentAndPrediction() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory original =
            _factoryTestConfig(makeAddr("mutationOriginalOwner"));
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory mutated;
        bytes32 userSalt = bytes32(uint256(42));

        mutated = _copyConfig(original);
        mutated.poolManager = IPoolManager(makeAddr("mutationPoolManager"));
        _assertConfigMutationChanges(original, mutated, userSalt);

        mutated = _copyConfig(original);
        mutated.currency0 = Currency.wrap(makeAddr("mutationCurrency0"));
        _assertConfigMutationChanges(original, mutated, userSalt);

        mutated = _copyConfig(original);
        mutated.currency1 = Currency.wrap(makeAddr("mutationCurrency1"));
        _assertConfigMutationChanges(original, mutated, userSalt);

        mutated = _copyConfig(original);
        mutated.lpFeePips = 500;
        _assertConfigMutationChanges(original, mutated, userSalt);

        mutated = _copyConfig(original);
        mutated.tickSpacing = 10;
        _assertConfigMutationChanges(original, mutated, userSalt);

        mutated = _copyConfig(original);
        mutated.quoteCurrency = makeAddr("mutationQuoteCurrency");
        _assertConfigMutationChanges(original, mutated, userSalt);

        mutated = _copyConfig(original);
        mutated.projectFeeOwner = makeAddr("mutationProjectOwner");
        _assertConfigMutationChanges(original, mutated, userSalt);

        mutated = _copyConfig(original);
        mutated.selectedBuyHundredthsOfBip += 1;
        _assertConfigMutationChanges(original, mutated, userSalt);

        mutated = _copyConfig(original);
        mutated.selectedSellHundredthsOfBip += 1;
        _assertConfigMutationChanges(original, mutated, userSalt);

        mutated = _copyConfig(original);
        mutated.initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(1);
        _assertConfigMutationChanges(original, mutated, userSalt);
    }

    function testProjectOwnerMutationCannotFrontRunExpectedAddress() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory intended =
            _factoryTestConfig(makeAddr("ownerMutationVictim"));
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory mutated = _copyConfig(intended);
        mutated.projectFeeOwner = attacker;
        _assertMutatedConfigCannotSquat(intended, mutated);
    }

    function testRateMutationCannotFrontRunExpectedAddress() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory intended =
            _factoryTestConfig(makeAddr("rateMutationVictim"));
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory mutated = _copyConfig(intended);
        mutated.selectedBuyHundredthsOfBip = 900_000;
        mutated.selectedSellHundredthsOfBip = 800_000;
        _assertMutatedConfigCannotSquat(intended, mutated);
    }

    function testInitialPriceMutationCannotFrontRunExpectedAddress() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory intended =
            _factoryTestConfig(makeAddr("priceMutationVictim"));
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory mutated = _copyConfig(intended);
        mutated.initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(60);
        _assertMutatedConfigCannotSquat(intended, mutated);
    }

    function testPredictionMatchesDeploymentFlagsAndEmittedBindings() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            _factoryTestConfig(makeAddr("predictionOwner"));
        (address predicted, bytes32 userSalt) = _mineHook(config);
        (address predictedAgain, bytes32 effectiveSalt_, bytes32 registrationConfigHash_) =
            hookFactory.predictHookAddress(userSalt, config);
        bytes32 expectedRegistrationConfigHash = _expectedRegistrationConfigHash(config);
        bytes32 expectedEffectiveSalt =
            keccak256(abi.encode(hookFactory.EFFECTIVE_SALT_DOMAIN(), userSalt, expectedRegistrationConfigHash));
        address expectedPrediction = Create2.computeAddress(
            expectedEffectiveSalt,
            hookFactory.initCodeHash(config.poolManager, config.quoteCurrency),
            address(hookFactory)
        );
        bytes32 expectedPoolId = _expectedPoolId(predicted, config);
        bytes32 expectedRuntimeConfigurationHash =
            _expectedRuntimeConfigurationHash(predicted, config, expectedPoolId, 0);
        bytes32 expectedFactoryConfigurationHash = keccak256(
            abi.encode(
                hookFactory.FACTORY_CONFIGURATION_DOMAIN(),
                block.chainid,
                address(hookFactory),
                predicted,
                expectedRuntimeConfigurationHash
            )
        );

        assertEq(predictedAgain, predicted);
        assertEq(expectedPrediction, predicted);
        assertEq(uint160(predicted) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());
        assertEq(registrationConfigHash_, expectedRegistrationConfigHash);
        assertEq(registrationConfigHash_, hookFactory.registrationConfigHash(config));
        assertEq(effectiveSalt_, expectedEffectiveSalt);
        assertEq(effectiveSalt_, hookFactory.effectiveSalt(userSalt, config));

        vm.expectEmit(true, true, true, true, address(hookFactory));
        emit ProgrammableVolumeFeeHookDeployedAndRegistered(
            predicted,
            address(config.poolManager),
            expectedPoolId,
            userSalt,
            effectiveSalt_,
            registrationConfigHash_,
            expectedRuntimeConfigurationHash,
            expectedFactoryConfigurationHash
        );
        (ProgrammableVolumeFeeHookV2 deployed, bytes32 deployedPoolId, int24 initialTick, bytes32 factoryHash) =
            hookFactory.deployAndRegister(userSalt, config);

        assertEq(address(deployed), predicted);
        assertEq(deployedPoolId, expectedPoolId);
        assertEq(initialTick, 0);
        assertEq(factoryHash, expectedFactoryConfigurationHash);
        assertEq(hookFactory.registrationConfigHashOf(predicted), registrationConfigHash_);
        assertEq(hookFactory.effectiveSaltOf(predicted), effectiveSalt_);
        assertEq(hookFactory.runtimeConfigurationHashOf(predicted), expectedRuntimeConfigurationHash);
        assertEq(hookFactory.factoryConfigurationHashOf(predicted), expectedFactoryConfigurationHash);
    }

    function testExactCopiedConfigFrontRunReconcilesIdempotently() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            _factoryTestConfig(makeAddr("exactCopyVictimOwner"));
        (address predicted, bytes32 userSalt) = _mineHook(config);
        (, bytes32 effectiveSalt_, bytes32 registrationConfigHash_) = hookFactory.predictHookAddress(userSalt, config);

        vm.prank(attacker);
        (ProgrammableVolumeFeeHookV2 first, bytes32 firstPoolId, int24 firstTick, bytes32 firstFactoryHash) =
            hookFactory.deployAndRegister(userSalt, config);
        bytes32 runtimeConfigurationHash = first.runtimeConfigurationHash();

        vm.expectEmit(true, true, true, true, address(hookFactory));
        emit ProgrammableVolumeFeeHookDeploymentReconciled(
            predicted,
            address(config.poolManager),
            firstPoolId,
            userSalt,
            effectiveSalt_,
            registrationConfigHash_,
            runtimeConfigurationHash,
            firstFactoryHash
        );
        (ProgrammableVolumeFeeHookV2 second, bytes32 secondPoolId, int24 secondTick, bytes32 secondFactoryHash) =
            hookFactory.deployAndRegister(userSalt, config);

        assertEq(address(first), predicted);
        assertEq(address(second), predicted);
        assertEq(secondPoolId, firstPoolId);
        assertEq(secondTick, firstTick);
        assertEq(secondFactoryHash, firstFactoryHash);
        assertEq(first.projectFeeOwner(), config.projectFeeOwner);
        assertEq(hookFactory.registrationConfigHashOf(predicted), registrationConfigHash_);
        assertEq(hookFactory.effectiveSaltOf(predicted), effectiveSalt_);
        assertEq(hookFactory.runtimeConfigurationHashOf(predicted), runtimeConfigurationHash);
        assertEq(hookFactory.factoryConfigurationHashOf(predicted), firstFactoryHash);
    }

    function testOccupiedAddressWithoutMatchingFactoryAndRuntimeReceiptsFailsClosed() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            _factoryTestConfig(makeAddr("occupiedAddressOwner"));
        (address predicted, bytes32 userSalt) = _mineHook(config);
        vm.etch(predicted, hex"6000");

        vm.expectPartialRevert(ProgrammableVolumeFeeHookFactoryV2.ExistingDeploymentReceiptMismatch.selector);
        hookFactory.deployAndRegister(userSalt, config);

        assertEq(hookFactory.registrationConfigHashOf(predicted), bytes32(0));
        assertEq(hookFactory.effectiveSaltOf(predicted), bytes32(0));
        assertEq(hookFactory.runtimeConfigurationHashOf(predicted), bytes32(0));
        assertEq(hookFactory.factoryConfigurationHashOf(predicted), bytes32(0));
    }

    function testStoredFactoryReceiptWithoutObservableRuntimeReceiptFailsClosed() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            _factoryTestConfig(makeAddr("destroyedRuntimeOwner"));
        (address predicted, bytes32 userSalt) = _mineHook(config);
        hookFactory.deployAndRegister(userSalt, config);
        vm.etch(predicted, hex"6000");

        vm.expectPartialRevert(ProgrammableVolumeFeeHookFactoryV2.ExistingDeploymentReceiptMismatch.selector);
        hookFactory.deployAndRegister(userSalt, config);
    }

    function testChainIdChangesConfigCommitmentEffectiveSaltAndPrediction() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            _factoryTestConfig(makeAddr("chainBoundOwner"));
        bytes32 userSalt = bytes32(uint256(77));
        uint256 originalChainId = block.chainid;
        bytes32 originalConfigHash = hookFactory.registrationConfigHash(config);
        (address originalPrediction, bytes32 originalEffectiveSalt,) = hookFactory.predictHookAddress(userSalt, config);

        vm.chainId(originalChainId + 1);
        bytes32 changedConfigHash = hookFactory.registrationConfigHash(config);
        (address changedPrediction, bytes32 changedEffectiveSalt,) = hookFactory.predictHookAddress(userSalt, config);

        assertNotEq(changedConfigHash, originalConfigHash);
        assertNotEq(changedEffectiveSalt, originalEffectiveSalt);
        assertNotEq(changedPrediction, originalPrediction);
        vm.chainId(originalChainId);
    }

    function testFactoryAddressChangesConfigCommitmentEffectiveSaltAndPrediction() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            _factoryTestConfig(makeAddr("factoryBoundOwner"));
        ProgrammableVolumeFeeHookFactoryV2 otherFactory = new ProgrammableVolumeFeeHookFactoryV2();
        bytes32 userSalt = bytes32(uint256(88));

        bytes32 originalConfigHash = hookFactory.registrationConfigHash(config);
        (address originalPrediction, bytes32 originalEffectiveSalt,) = hookFactory.predictHookAddress(userSalt, config);
        bytes32 otherConfigHash = otherFactory.registrationConfigHash(config);
        (address otherPrediction, bytes32 otherEffectiveSalt,) = otherFactory.predictHookAddress(userSalt, config);

        assertNotEq(address(otherFactory), address(hookFactory));
        assertNotEq(otherConfigHash, originalConfigHash);
        assertNotEq(otherEffectiveSalt, originalEffectiveSalt);
        assertNotEq(otherPrediction, originalPrediction);
    }

    function testFactoryCannotLeaveAnUnregisteredHookOrReceipt() public {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory invalid =
            ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig({
                poolManager: manager,
                currency0: Currency.wrap(address(projectToken)),
                currency1: CurrencyLibrary.ADDRESS_ZERO,
                lpFeePips: LP_FEE_PIPS,
                tickSpacing: TICK_SPACING,
                quoteCurrency: address(projectToken),
                projectFeeOwner: projectFeeOwner,
                selectedBuyHundredthsOfBip: SELECTED_THREE_PERCENT,
                selectedSellHundredthsOfBip: SELECTED_THREE_PERCENT,
                initialSqrtPriceX96: SQRT_PRICE_1_1
            });
        (address predicted, bytes32 userSalt) = _mineHook(invalid);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableVolumeFeeHookV2.CurrenciesOutOfOrderOrEqual.selector, address(projectToken), address(0)
            )
        );
        hookFactory.deployAndRegister(userSalt, invalid);
        assertEq(predicted.code.length, 0);
        assertEq(hookFactory.runtimeConfigurationHashOf(predicted), bytes32(0));
        assertEq(hookFactory.factoryConfigurationHashOf(predicted), bytes32(0));
        assertEq(hookFactory.registrationConfigHashOf(predicted), bytes32(0));
        assertEq(hookFactory.effectiveSaltOf(predicted), bytes32(0));
    }

    function testPoolManagerCallbackAuthentication() public {
        SwapParams memory params =
            SwapParams({ zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT });
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), hookKey, params, ZERO_BYTES);
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), hookKey, params, BalanceDelta.wrap(0), ZERO_BYTES);
    }

    function _factoryTestConfig(address owner)
        private
        view
        returns (ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config)
    {
        config = ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig({
            poolManager: manager,
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(projectToken)),
            lpFeePips: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            quoteCurrency: address(0),
            projectFeeOwner: owner,
            selectedBuyHundredthsOfBip: 40_000,
            selectedSellHundredthsOfBip: 50_000,
            initialSqrtPriceX96: SQRT_PRICE_1_1
        });
    }

    function _copyConfig(ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory source)
        private
        pure
        returns (ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory copy)
    {
        copy = ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig({
            poolManager: source.poolManager,
            currency0: source.currency0,
            currency1: source.currency1,
            lpFeePips: source.lpFeePips,
            tickSpacing: source.tickSpacing,
            quoteCurrency: source.quoteCurrency,
            projectFeeOwner: source.projectFeeOwner,
            selectedBuyHundredthsOfBip: source.selectedBuyHundredthsOfBip,
            selectedSellHundredthsOfBip: source.selectedSellHundredthsOfBip,
            initialSqrtPriceX96: source.initialSqrtPriceX96
        });
    }

    function _assertConfigMutationChanges(
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory original,
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory mutated,
        bytes32 userSalt
    ) private view {
        bytes32 originalConfigHash = hookFactory.registrationConfigHash(original);
        bytes32 mutatedConfigHash = hookFactory.registrationConfigHash(mutated);
        (address originalPrediction, bytes32 originalEffectiveSalt, bytes32 predictedOriginalConfigHash) =
            hookFactory.predictHookAddress(userSalt, original);
        (address mutatedPrediction, bytes32 mutatedEffectiveSalt, bytes32 predictedMutatedConfigHash) =
            hookFactory.predictHookAddress(userSalt, mutated);

        assertEq(predictedOriginalConfigHash, originalConfigHash);
        assertEq(predictedMutatedConfigHash, mutatedConfigHash);
        assertNotEq(mutatedConfigHash, originalConfigHash);
        assertNotEq(mutatedEffectiveSalt, originalEffectiveSalt);
        assertNotEq(mutatedPrediction, originalPrediction);
    }

    function _assertMutatedConfigCannotSquat(
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory intended,
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory mutated
    ) private {
        (address intendedPrediction, bytes32 copiedUserSalt) = _mineHook(intended);
        (address mutatedPrediction,, bytes32 mutatedConfigHash) =
            hookFactory.predictHookAddress(copiedUserSalt, mutated);
        assertNotEq(mutatedConfigHash, hookFactory.registrationConfigHash(intended));
        assertNotEq(mutatedPrediction, intendedPrediction);

        uint160 mutatedFlags = uint160(mutatedPrediction) & hookFactory.ALL_HOOK_MASK();
        uint160 requiredFlags = hookFactory.REQUIRED_HOOK_FLAGS();
        if (mutatedFlags == requiredFlags) {
            vm.prank(attacker);
            (ProgrammableVolumeFeeHookV2 mutatedHook,,,) = hookFactory.deployAndRegister(copiedUserSalt, mutated);
            assertEq(address(mutatedHook), mutatedPrediction);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableVolumeFeeHookFactoryV2.InvalidHookAddress.selector,
                    mutatedPrediction,
                    mutatedFlags,
                    requiredFlags
                )
            );
            vm.prank(attacker);
            hookFactory.deployAndRegister(copiedUserSalt, mutated);
        }

        (ProgrammableVolumeFeeHookV2 intendedHook,,,) = hookFactory.deployAndRegister(copiedUserSalt, intended);
        assertEq(address(intendedHook), intendedPrediction);
        assertEq(intendedHook.projectFeeOwner(), intended.projectFeeOwner);
    }

    function _expectedRegistrationConfigHash(ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                hookFactory.REGISTRATION_CONFIG_DOMAIN(),
                block.chainid,
                address(hookFactory),
                address(config.poolManager),
                Currency.unwrap(config.currency0),
                Currency.unwrap(config.currency1),
                config.lpFeePips,
                config.tickSpacing,
                config.quoteCurrency,
                config.projectFeeOwner,
                config.selectedBuyHundredthsOfBip,
                config.selectedSellHundredthsOfBip,
                config.initialSqrtPriceX96
            )
        );
    }

    function _expectedPoolId(address predicted, ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config)
        private
        pure
        returns (bytes32)
    {
        PoolKey memory expectedKey = PoolKey({
            currency0: config.currency0,
            currency1: config.currency1,
            fee: config.lpFeePips,
            tickSpacing: config.tickSpacing,
            hooks: ProgrammableVolumeFeeHookV2(predicted)
        });
        return PoolId.unwrap(expectedKey.toId());
    }

    function _expectedRuntimeConfigurationHash(
        address predicted,
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config,
        bytes32 expectedPoolId,
        int24 initialTick
    ) private view returns (bytes32) {
        uint32 effectiveBuy = config.selectedBuyHundredthsOfBip < hook.MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP()
            ? hook.MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP()
            : config.selectedBuyHundredthsOfBip;
        uint32 effectiveSell = config.selectedSellHundredthsOfBip < hook.MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP()
            ? hook.MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP()
            : config.selectedSellHundredthsOfBip;
        return keccak256(
            abi.encode(
                hook.RUNTIME_CONFIGURATION_DOMAIN(),
                block.chainid,
                predicted,
                address(config.poolManager),
                address(hookFactory),
                config.quoteCurrency,
                hook.PROGRAMMABLE_FEE_OWNER(),
                hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP(),
                hook.PROGRAMMABLE_FEE_POLICY_HASH(),
                hook.COLLECTION_PROFILE_HASH(),
                expectedPoolId,
                Currency.unwrap(config.currency0),
                Currency.unwrap(config.currency1),
                Currency.unwrap(config.currency0) == config.quoteCurrency,
                config.lpFeePips,
                config.tickSpacing,
                config.initialSqrtPriceX96,
                initialTick,
                config.projectFeeOwner,
                config.selectedBuyHundredthsOfBip,
                config.selectedSellHundredthsOfBip,
                effectiveBuy,
                effectiveSell
            )
        );
    }

    function _mineHook(ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config)
        private
        view
        returns (address predicted, bytes32 userSalt)
    {
        for (uint256 candidate; candidate < 1_000_000; ++candidate) {
            userSalt = bytes32(candidate);
            (predicted,,) = hookFactory.predictHookAddress(userSalt, config);
            if ((uint160(predicted) & hookFactory.ALL_HOOK_MASK()) == hookFactory.REQUIRED_HOOK_FLAGS()) {
                return (predicted, userSalt);
            }
        }
        revert("valid hook user salt not found");
    }

    function _deployAndRegisterHook(
        address quoteCurrency,
        Currency currency0,
        Currency currency1,
        uint24 lpFeePips,
        int24 tickSpacing,
        address projectOwner,
        uint32 selectedBuy,
        uint32 selectedSell,
        uint160 initialSqrtPriceX96
    ) private returns (ProgrammableVolumeFeeHookV2 deployed) {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig({
                poolManager: manager,
                currency0: currency0,
                currency1: currency1,
                lpFeePips: lpFeePips,
                tickSpacing: tickSpacing,
                quoteCurrency: quoteCurrency,
                projectFeeOwner: projectOwner,
                selectedBuyHundredthsOfBip: selectedBuy,
                selectedSellHundredthsOfBip: selectedSell,
                initialSqrtPriceX96: initialSqrtPriceX96
            });
        (, bytes32 userSalt) = _mineHook(config);
        (deployed,,,) = hookFactory.deployAndRegister(userSalt, config);
    }

    function _findThreePercentWitness(uint256 netQuoteAmount) private view returns (uint256 grossQuoteWitness) {
        uint256 estimate = (netQuoteAmount * 1_000_000 + 969_999) / 970_000;
        uint256 candidate = estimate > 8 ? estimate - 8 : 1;
        for (uint256 index; index < 32; ++index) {
            (bool valid,,,,,) = hook.quoteExactOutputWitness(netQuoteAmount, candidate, SELECTED_THREE_PERCENT);
            if (valid) return candidate;
            ++candidate;
        }
        revert("witness not found");
    }

    function decodeWrappedError(bytes calldata reason)
        external
        pure
        returns (address target, bytes4 callbackSelector, bytes memory innerReason, bytes memory details)
    {
        require(reason.length >= 4 && bytes4(reason[:4]) == CustomRevert.WrappedError.selector, "not WrappedError");
        return abi.decode(reason[4:], (address, bytes4, bytes, bytes));
    }

    function decodeInvalidWitness(bytes calldata innerReason)
        external
        pure
        returns (uint256 netQuoteAmount, uint256 grossQuoteWitness)
    {
        require(
            innerReason.length == 68
                && bytes4(innerReason[:4]) == ProgrammableVolumeFeeHookV2.InvalidExactOutputWitness.selector,
            "not InvalidExactOutputWitness"
        );
        return abi.decode(innerReason[4:], (uint256, uint256));
    }
}
