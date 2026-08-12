// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";

import { ProgrammableVolumeFeeHookFactoryV2 } from "../../src/ProgrammableVolumeFeeHookFactoryV2.sol";
import { ProgrammableVolumeFeeHookV2 } from "../../src/ProgrammableVolumeFeeHookV2.sol";
import { MockReferenceToken } from "../MockReferenceToken.sol";

abstract contract ProgrammableVolumeFeeHookV2Erc20Fixture is Deployers {
    using PoolIdLibrary for PoolKey;

    uint24 internal constant ERC20_LP_FEE_PIPS = 3000;
    int24 internal constant ERC20_TICK_SPACING = 60;
    uint32 internal constant ERC20_SELECTED_THREE_PERCENT = 30_000;

    ProgrammableVolumeFeeHookFactoryV2 internal erc20HookFactory;
    ProgrammableVolumeFeeHookV2 internal erc20Hook;
    MockReferenceToken internal quoteToken;
    MockReferenceToken internal launchedToken;
    PoolKey internal erc20HookKey;
    bytes32 internal erc20PoolId;

    address internal erc20ProjectFeeOwner;
    PoolSwapTest.TestSettings internal erc20SwapSettings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function _setUpErc20Pool() internal {
        deployFreshManagerAndRouters();
        erc20ProjectFeeOwner = makeAddr("erc20ProjectFeeOwner");
        erc20HookFactory = new ProgrammableVolumeFeeHookFactoryV2();
        quoteToken = new MockReferenceToken("Reference Quote", "RQUOTE");
        launchedToken = new MockReferenceToken("Reference Launch", "RLAUNCH");

        Currency quote = Currency.wrap(address(quoteToken));
        Currency launched = Currency.wrap(address(launchedToken));
        (Currency currency0_, Currency currency1_) =
            address(quoteToken) < address(launchedToken) ? (quote, launched) : (launched, quote);
        erc20Hook = _deployAndRegisterErc20Hook(address(quoteToken), currency0_, currency1_);

        uint256 testFunding = 10_000_000 ether;
        quoteToken.mint(address(this), testFunding);
        launchedToken.mint(address(this), testFunding);
        quoteToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        quoteToken.approve(address(swapRouter), type(uint256).max);
        launchedToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        launchedToken.approve(address(swapRouter), type(uint256).max);

        erc20HookKey = PoolKey({
            currency0: currency0_,
            currency1: currency1_,
            fee: ERC20_LP_FEE_PIPS,
            tickSpacing: ERC20_TICK_SPACING,
            hooks: erc20Hook
        });
        erc20PoolId = PoolId.unwrap(erc20HookKey.toId());
        ModifyLiquidityParams memory liquidity =
            ModifyLiquidityParams({ tickLower: -120, tickUpper: 120, liquidityDelta: 1000 ether, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity(erc20HookKey, liquidity, ZERO_BYTES);
    }

    function _deployAndRegisterErc20Hook(address quoteCurrency, Currency currency0, Currency currency1)
        internal
        returns (ProgrammableVolumeFeeHookV2 deployed)
    {
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig({
                poolManager: manager,
                currency0: currency0,
                currency1: currency1,
                lpFeePips: ERC20_LP_FEE_PIPS,
                tickSpacing: ERC20_TICK_SPACING,
                quoteCurrency: quoteCurrency,
                projectFeeOwner: erc20ProjectFeeOwner,
                selectedBuyHundredthsOfBip: ERC20_SELECTED_THREE_PERCENT,
                selectedSellHundredthsOfBip: ERC20_SELECTED_THREE_PERCENT,
                initialSqrtPriceX96: SQRT_PRICE_1_1
            });
        (, bytes32 userSalt) = _mineErc20Hook(config);
        (deployed,,,) = erc20HookFactory.deployAndRegister(userSalt, config);
    }

    function _mineErc20Hook(ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config)
        private
        view
        returns (address predicted, bytes32 userSalt)
    {
        for (uint256 candidate; candidate < 1_000_000; ++candidate) {
            userSalt = bytes32(candidate);
            (predicted,,) = erc20HookFactory.predictHookAddress(userSalt, config);
            if ((uint160(predicted) & erc20HookFactory.ALL_HOOK_MASK()) == erc20HookFactory.REQUIRED_HOOK_FLAGS()) {
                return (predicted, userSalt);
            }
        }
        revert("valid ERC20 hook user salt not found");
    }

    function _buyZeroForOne() internal view returns (bool) {
        return erc20Hook.quoteIsCurrency0();
    }

    function _sellZeroForOne() internal view returns (bool) {
        return !erc20Hook.quoteIsCurrency0();
    }

    function _priceLimit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT;
    }
}
