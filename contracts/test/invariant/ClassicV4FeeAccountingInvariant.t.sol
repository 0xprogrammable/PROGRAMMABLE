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

import { EthCreatorFeeHookFactoryV4 } from "../../src/EthCreatorFeeHookFactoryV4.sol";
import { EthCreatorFeeHookV4 } from "../../src/EthCreatorFeeHookV4.sol";
import { FeeSplitVaultFactoryV1 } from "../../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../../src/FeeSplitVaultV1.sol";
import { IClassicFeeHookV3 } from "../../src/interfaces/IClassicFeeHookV3.sol";

contract ClassicV4InvariantToken is MockERC20 {
    address public immutable creator;

    constructor(string memory name_, string memory symbol_, address creator_) MockERC20(name_, symbol_, 18) {
        creator = creator_;
    }
}

contract ClassicV4AccountingHandler {
    using SafeCast for uint256;

    address internal immutable configurator;
    PoolSwapTest internal immutable router;

    EthCreatorFeeHookV4 internal hook;
    FeeSplitVaultV1 internal minimumVault;
    FeeSplitVaultV1 internal asymmetricVault;
    IERC20 internal minimumToken;
    IERC20 internal asymmetricToken;
    PoolKey internal minimumKey;
    PoolKey internal asymmetricKey;

    bool internal configured;
    uint256 public creatorFeesClaimed;
    uint256 public launcherFeesClaimed;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    error AlreadyConfigured();
    error UnauthorizedConfigurator(address caller);

    constructor(PoolSwapTest router_) {
        configurator = msg.sender;
        router = router_;
    }

    function configure(
        EthCreatorFeeHookV4 hook_,
        FeeSplitVaultV1 minimumVault_,
        FeeSplitVaultV1 asymmetricVault_,
        IERC20 minimumToken_,
        IERC20 asymmetricToken_,
        PoolKey calldata minimumKey_,
        PoolKey calldata asymmetricKey_
    ) external {
        if (msg.sender != configurator) revert UnauthorizedConfigurator(msg.sender);
        if (configured) revert AlreadyConfigured();

        hook = hook_;
        minimumVault = minimumVault_;
        asymmetricVault = asymmetricVault_;
        minimumToken = minimumToken_;
        asymmetricToken = asymmetricToken_;
        minimumKey = minimumKey_;
        asymmetricKey = asymmetricKey_;
        configured = true;

        minimumToken_.approve(address(router), type(uint256).max);
        asymmetricToken_.approve(address(router), type(uint256).max);
    }

    function minimumBuyExactInput(uint96 rawAmount) external {
        _buyExactInput(minimumKey, rawAmount);
    }

    function minimumSellExactInput(uint96 rawAmount) external {
        _sellExactInput(minimumKey, minimumToken, rawAmount);
    }

    function minimumBuyExactOutput(uint96 rawAmount) external {
        _buyExactOutput(minimumKey, rawAmount);
    }

    function minimumSellExactOutput(uint96 rawAmount) external {
        _sellExactOutput(minimumKey, minimumToken, rawAmount);
    }

    function asymmetricBuyExactInput(uint96 rawAmount) external {
        _buyExactInput(asymmetricKey, rawAmount);
    }

    function asymmetricSellExactInput(uint96 rawAmount) external {
        _sellExactInput(asymmetricKey, asymmetricToken, rawAmount);
    }

    function asymmetricBuyExactOutput(uint96 rawAmount) external {
        _buyExactOutput(asymmetricKey, rawAmount);
    }

    function asymmetricSellExactOutput(uint96 rawAmount) external {
        _sellExactOutput(asymmetricKey, asymmetricToken, rawAmount);
    }

    function claimMinimumCreator() external {
        try minimumVault.claim() returns (uint256 amount) {
            creatorFeesClaimed += amount;
        } catch { }
    }

    function claimAsymmetricCreator() external {
        try asymmetricVault.claim() returns (uint256 amount) {
            creatorFeesClaimed += amount;
        } catch { }
    }

    function claimLauncher() external {
        try hook.claimLauncherFeesTo(address(this)) returns (uint256 amount) {
            launcherFeesClaimed += amount;
        } catch { }
    }

    function _buyExactInput(PoolKey memory key, uint96 rawAmount) private {
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

    function _sellExactInput(PoolKey memory key, IERC20 token, uint96 rawAmount) private {
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

    function _buyExactOutput(PoolKey memory key, uint96 rawAmount) private {
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e12);
        uint256 value = amount * 5;
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

    function _sellExactOutput(PoolKey memory key, IERC20 token, uint96 rawAmount) private {
        if (token.balanceOf(address(this)) == 0) return;
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e12);
        router.swap(
            key,
            SwapParams({
                zeroForOne: false, amountSpecified: amount.toInt256(), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    receive() external payable { }
}

contract ClassicV4FeeAccountingInvariantTest is Deployers {
    EthCreatorFeeHookFactoryV4 internal hookFactory;
    FeeSplitVaultFactoryV1 internal vaultFactory;
    EthCreatorFeeHookV4 internal hook;
    FeeSplitVaultV1 internal minimumVault;
    FeeSplitVaultV1 internal asymmetricVault;
    ClassicV4InvariantToken internal minimumToken;
    ClassicV4InvariantToken internal asymmetricToken;
    ClassicV4AccountingHandler internal handler;
    PoolKey internal minimumKey;
    PoolKey internal asymmetricKey;
    bytes32 internal minimumPoolId;
    bytes32 internal asymmetricPoolId;

    function setUp() public {
        deployFreshManagerAndRouters();
        vm.deal(address(this), 1_000_000 ether);

        handler = new ClassicV4AccountingHandler(swapRouter);
        vaultFactory = new FeeSplitVaultFactoryV1();
        hookFactory = new EthCreatorFeeHookFactoryV4();
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV4).creationCode,
            abi.encode(manager, address(handler), vaultFactory)
        );
        hook = hookFactory.deploy(hookSalt, manager, address(handler), vaultFactory);

        minimumToken = new ClassicV4InvariantToken("Classic V4 Minimum", "CV4M", address(this));
        asymmetricToken = new ClassicV4InvariantToken("Classic V4 Asymmetric", "CV4A", address(this));
        minimumToken.mint(address(this), 1e36);
        asymmetricToken.mint(address(this), 1e36);
        minimumToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        asymmetricToken.approve(address(modifyLiquidityRouter), type(uint256).max);

        minimumKey = _poolKey(address(minimumToken));
        asymmetricKey = _poolKey(address(asymmetricToken));
        minimumPoolId = PoolId.unwrap(minimumKey.toId());
        asymmetricPoolId = PoolId.unwrap(asymmetricKey.toId());

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = address(handler);
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;

        minimumVault = vaultFactory.deploy(
            bytes32("classic-v4-minimum-invariant"),
            IClassicFeeHookV3(address(hook)),
            minimumPoolId,
            beneficiaries,
            shares
        );
        asymmetricVault = vaultFactory.deploy(
            bytes32("classic-v4-asym-invariant"),
            IClassicFeeHookV3(address(hook)),
            asymmetricPoolId,
            beneficiaries,
            shares
        );

        hook.registerPool(minimumKey, address(minimumVault), 10, 10);
        hook.registerPool(asymmetricKey, address(asymmetricVault), 110, 370);
        manager.initialize(minimumKey, SQRT_PRICE_1_1);
        manager.initialize(asymmetricKey, SQRT_PRICE_1_1);

        ModifyLiquidityParams memory liquidity =
            ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1e22, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(minimumKey, liquidity, ZERO_BYTES);
        modifyLiquidityRouter.modifyLiquidity{ value: 1000 ether }(asymmetricKey, liquidity, ZERO_BYTES);

        handler.configure(
            hook,
            minimumVault,
            asymmetricVault,
            IERC20(address(minimumToken)),
            IERC20(address(asymmetricToken)),
            minimumKey,
            asymmetricKey
        );
        assertTrue(minimumToken.transfer(address(handler), 1e30));
        assertTrue(asymmetricToken.transfer(address(handler), 1e30));
        vm.deal(address(handler), 10_000 ether);

        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = ClassicV4AccountingHandler.minimumBuyExactInput.selector;
        selectors[1] = ClassicV4AccountingHandler.minimumSellExactInput.selector;
        selectors[2] = ClassicV4AccountingHandler.minimumBuyExactOutput.selector;
        selectors[3] = ClassicV4AccountingHandler.minimumSellExactOutput.selector;
        selectors[4] = ClassicV4AccountingHandler.asymmetricBuyExactInput.selector;
        selectors[5] = ClassicV4AccountingHandler.asymmetricSellExactInput.selector;
        selectors[6] = ClassicV4AccountingHandler.asymmetricBuyExactOutput.selector;
        selectors[7] = ClassicV4AccountingHandler.asymmetricSellExactOutput.selector;
        selectors[8] = ClassicV4AccountingHandler.claimMinimumCreator.selector;
        selectors[9] = ClassicV4AccountingHandler.claimAsymmetricCreator.selector;
        selectors[10] = ClassicV4AccountingHandler.claimLauncher.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_currentClaimsExactlyCoverAllAccruedAccounting() public view {
        uint256 nativeClaims = manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
        (,,,,, uint256 minimumCreatorFees) = hook.poolFeeConfig(minimumPoolId);
        (,,,,, uint256 asymmetricCreatorFees) = hook.poolFeeConfig(asymmetricPoolId);
        uint256 launcherFees = hook.launcherFeesAccrued();
        uint256 expectedCurrentAccounting = minimumCreatorFees + asymmetricCreatorFees + launcherFees;

        assertEq(minimumCreatorFees, 0);
        assertEq(expectedCurrentAccounting, hook.totalNativeFeesAccrued());
        assertEq(nativeClaims, hook.totalNativeFeesAccrued());
        assertEq(manager.balanceOf(address(hook), minimumKey.currency1.toId()), 0);
        assertEq(manager.balanceOf(address(hook), asymmetricKey.currency1.toId()), 0);
    }

    function invariant_minimumFeePoolNeverCreatesCreatorRewards() public view {
        (address rewardVault, address registrar, uint16 buy, uint16 sell, bool registered, uint256 creatorFees) =
            hook.poolFeeConfig(minimumPoolId);
        assertEq(rewardVault, address(minimumVault));
        assertEq(registrar, address(this));
        assertEq(buy, 10);
        assertEq(sell, 10);
        assertTrue(registered);
        assertEq(creatorFees, 0);

        (
            uint16 disclosedBuy,
            uint16 disclosedSell,
            uint16 buyCreator,
            uint16 sellCreator,
            uint16 platform,
            uint16 transferTax,
            uint24 lpFee,
            address disclosedVault
        ) = hook.feeDisclosure(minimumPoolId);
        assertEq(disclosedBuy, 10);
        assertEq(disclosedSell, 10);
        assertEq(buyCreator, 0);
        assertEq(sellCreator, 0);
        assertEq(platform, 10);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(disclosedVault, address(minimumVault));
    }

    function invariant_asymmetricDirectionalEconomicsNeverChange() public view {
        (address rewardVault, address registrar, uint16 buy, uint16 sell, bool registered,) =
            hook.poolFeeConfig(asymmetricPoolId);
        assertEq(rewardVault, address(asymmetricVault));
        assertEq(registrar, address(this));
        assertEq(buy, 110);
        assertEq(sell, 370);
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
        ) = hook.feeDisclosure(asymmetricPoolId);
        assertEq(disclosedBuy, 110);
        assertEq(disclosedSell, 370);
        assertEq(buyCreator, 100);
        assertEq(sellCreator, 360);
        assertEq(platform, 10);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(disclosedVault, address(asymmetricVault));
    }

    function invariant_creatorClaimsRemainConservedAcrossInterleaving() public view {
        assertEq(minimumVault.totalCreatorFeesReceived(), 0);
        assertEq(minimumVault.totalCreatorFeesClaimed(), 0);
        assertEq(minimumVault.claimable(address(handler)), 0);

        uint256 received = asymmetricVault.totalCreatorFeesReceived();
        uint256 claimed = asymmetricVault.totalCreatorFeesClaimed();
        uint256 claimable = asymmetricVault.claimable(address(handler));
        assertEq(received, claimed + claimable);
        assertEq(claimed, handler.creatorFeesClaimed());
        assertEq(address(asymmetricVault).balance, received - claimed);
    }

    function invariant_treasuryAndHookIdentityNeverChange() public view {
        assertEq(hook.launcherFeeRecipient(), address(handler));
        assertEq(uint160(address(hook)) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertEq(address(hook).balance, 0);
        assertEq(minimumToken.balanceOf(address(hook)), 0);
        assertEq(asymmetricToken.balanceOf(address(hook)), 0);
    }

    function _poolKey(address token) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: 0,
            tickSpacing: 200,
            hooks: hook
        });
    }
}
