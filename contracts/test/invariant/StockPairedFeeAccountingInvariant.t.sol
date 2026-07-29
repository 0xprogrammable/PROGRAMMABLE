// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IBeacon } from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { QuoteAssetCreatorFeeHookFactoryV1 } from "../../src/QuoteAssetCreatorFeeHookFactoryV1.sol";
import { QuoteAssetCreatorFeeHookV1 } from "../../src/QuoteAssetCreatorFeeHookV1.sol";
import { QuoteAssetFeeSplitVaultFactoryV1 } from "../../src/QuoteAssetFeeSplitVaultFactoryV1.sol";
import { QuoteAssetFeeSplitVaultV1 } from "../../src/QuoteAssetFeeSplitVaultV1.sol";
import { StockQuoteRegistryV1 } from "../../src/StockQuoteRegistryV1.sol";
import { IQuoteAssetCreatorFeeHookV1 } from "../../src/interfaces/IQuoteAssetCreatorFeeHookV1.sol";

contract StockPairedInvariantQuoteToken is ERC20 {
    constructor(string memory symbol_) ERC20(string.concat("Invariant ", symbol_), symbol_) { }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract StockPairedInvariantCreatorToken is ERC20 {
    address public immutable creator;

    constructor(address creator_) ERC20("Stock Paired Invariant", "SPI") {
        creator = creator_;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract StockPairedInvariantImplementation { }

contract StockPairedInvariantBeacon is IBeacon {
    address private immutable _implementation;

    constructor(address implementation_) {
        _implementation = implementation_;
    }

    function implementation() external view returns (address) {
        return _implementation;
    }
}

contract StockPairedSwapHandler {
    using SafeCast for uint256;

    PoolSwapTest internal immutable router;
    IERC20 internal immutable quoteAsset;
    IERC20 internal immutable launchedToken;
    bool internal immutable quoteIsCurrency0;
    PoolKey internal poolKey;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    constructor(
        PoolSwapTest router_,
        IERC20 quoteAsset_,
        IERC20 launchedToken_,
        PoolKey memory poolKey_,
        bool quoteIsCurrency0_
    ) {
        router = router_;
        quoteAsset = quoteAsset_;
        launchedToken = launchedToken_;
        poolKey = poolKey_;
        quoteIsCurrency0 = quoteIsCurrency0_;
        quoteAsset_.approve(address(router_), type(uint256).max);
        launchedToken_.approve(address(router_), type(uint256).max);
    }

    function buyExactInput(uint96 rawAmount) external {
        uint256 balance = quoteAsset.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e16);
        if (amount > balance) amount = balance;
        router.swap(
            poolKey,
            SwapParams({
                zeroForOne: quoteIsCurrency0,
                amountSpecified: -amount.toInt256(),
                sqrtPriceLimitX96: quoteIsCurrency0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function sellExactInput(uint96 rawAmount) external {
        uint256 balance = launchedToken.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e16);
        if (amount > balance) amount = balance;
        router.swap(
            poolKey,
            SwapParams({
                zeroForOne: !quoteIsCurrency0,
                amountSpecified: -amount.toInt256(),
                sqrtPriceLimitX96: quoteIsCurrency0 ? TickMath.MAX_SQRT_PRICE - 1 : TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }

    function buyExactOutput(uint96 rawAmount) external {
        if (quoteAsset.balanceOf(address(this)) == 0) return;
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e12);
        router.swap(
            poolKey,
            SwapParams({
                zeroForOne: quoteIsCurrency0,
                amountSpecified: amount.toInt256(),
                sqrtPriceLimitX96: quoteIsCurrency0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
    }

    function sellExactOutput(uint96 rawAmount) external {
        if (launchedToken.balanceOf(address(this)) == 0) return;
        uint256 amount = 10_000 + (uint256(rawAmount) % 1e12);
        router.swap(
            poolKey,
            SwapParams({
                zeroForOne: !quoteIsCurrency0,
                amountSpecified: amount.toInt256(),
                sqrtPriceLimitX96: quoteIsCurrency0 ? TickMath.MAX_SQRT_PRICE - 1 : TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
    }
}

contract StockPairedBeneficiaryHandler {
    address internal immutable configurator;
    address internal immutable firstPayout;
    address internal immutable secondPayout;
    QuoteAssetFeeSplitVaultV1 internal vault;

    error AlreadyConfigured();
    error UnauthorizedConfigurator(address caller);

    constructor(address firstPayout_, address secondPayout_) {
        configurator = msg.sender;
        firstPayout = firstPayout_;
        secondPayout = secondPayout_;
    }

    function configure(QuoteAssetFeeSplitVaultV1 vault_) external {
        if (msg.sender != configurator) revert UnauthorizedConfigurator(msg.sender);
        if (address(vault) != address(0)) revert AlreadyConfigured();
        vault = vault_;
    }

    function claim() external {
        try vault.claim() { } catch { }
    }

    function useFirstPayout() external {
        try vault.setPayoutAddress(firstPayout) { } catch { }
    }

    function useSecondPayout() external {
        try vault.setPayoutAddress(secondPayout) { } catch { }
    }

    function isAllowedPayout(address payout) external view returns (bool) {
        return payout == address(this) || payout == firstPayout || payout == secondPayout;
    }
}

contract StockPairedFeeAccountingInvariantTest is Deployers {
    QuoteAssetCreatorFeeHookFactoryV1 internal hookFactory;
    QuoteAssetFeeSplitVaultFactoryV1 internal vaultFactory;
    QuoteAssetCreatorFeeHookV1 internal hook;
    QuoteAssetFeeSplitVaultV1 internal vault;
    StockPairedInvariantQuoteToken internal quoteAsset;
    StockPairedInvariantCreatorToken internal launchedToken;
    StockPairedSwapHandler internal swapHandler;
    StockPairedBeneficiaryHandler internal beneficiaryA;
    StockPairedBeneficiaryHandler internal beneficiaryB;
    PoolKey internal poolKey;
    bytes32 internal poolId;
    bool internal quoteIsCurrency0;

    address internal payoutA1;
    address internal payoutA2;
    address internal payoutB1;
    address internal payoutB2;
    address internal treasury;

    function setUp() public {
        deployFreshManagerAndRouters();

        StockPairedInvariantQuoteToken[7] memory assets;
        assets[0] = new StockPairedInvariantQuoteToken("NVDAon");
        assets[1] = new StockPairedInvariantQuoteToken("SPYon");
        assets[2] = new StockPairedInvariantQuoteToken("GOOGLon");
        assets[3] = new StockPairedInvariantQuoteToken("SLVon");
        assets[4] = new StockPairedInvariantQuoteToken("QQQon");
        assets[5] = new StockPairedInvariantQuoteToken("TSLAon");
        assets[6] = new StockPairedInvariantQuoteToken("AAPLon");
        quoteAsset = assets[0];
        StockPairedInvariantImplementation implementation = new StockPairedInvariantImplementation();
        StockPairedInvariantBeacon beacon = new StockPairedInvariantBeacon(address(implementation));
        StockQuoteRegistryV1 registry = new StockQuoteRegistryV1(
            _addresses(assets),
            _symbolHashes(assets),
            address(beacon),
            address(implementation),
            address(quoteAsset).codehash,
            address(beacon).codehash,
            address(implementation).codehash
        );

        treasury = makeAddr("stockPairedInvariantTreasury");
        vaultFactory = new QuoteAssetFeeSplitVaultFactoryV1();
        hookFactory = new QuoteAssetCreatorFeeHookFactoryV1();
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(QuoteAssetCreatorFeeHookV1).creationCode,
            abi.encode(manager, treasury, registry, vaultFactory)
        );
        hook = hookFactory.deploy(hookSalt, manager, treasury, registry, vaultFactory);

        launchedToken = new StockPairedInvariantCreatorToken(address(this));
        quoteIsCurrency0 = address(quoteAsset) < address(launchedToken);
        poolKey = quoteIsCurrency0
            ? PoolKey({
                currency0: Currency.wrap(address(quoteAsset)),
                currency1: Currency.wrap(address(launchedToken)),
                fee: 0,
                tickSpacing: 200,
                hooks: hook
            })
            : PoolKey({
                currency0: Currency.wrap(address(launchedToken)),
                currency1: Currency.wrap(address(quoteAsset)),
                fee: 0,
                tickSpacing: 200,
                hooks: hook
            });
        poolId = PoolId.unwrap(poolKey.toId());

        payoutA1 = makeAddr("stockPairedPayoutA1");
        payoutA2 = makeAddr("stockPairedPayoutA2");
        payoutB1 = makeAddr("stockPairedPayoutB1");
        payoutB2 = makeAddr("stockPairedPayoutB2");
        beneficiaryA = new StockPairedBeneficiaryHandler(payoutA1, payoutA2);
        beneficiaryB = new StockPairedBeneficiaryHandler(payoutB1, payoutB2);
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = address(beneficiaryA);
        beneficiaries[1] = address(beneficiaryB);
        uint16[] memory shares = new uint16[](2);
        shares[0] = 3333;
        shares[1] = 6667;
        vault = vaultFactory.deploy(
            bytes32("stock-paired-invariant"),
            IQuoteAssetCreatorFeeHookV1(address(hook)),
            poolId,
            IERC20(address(quoteAsset)),
            beneficiaries,
            shares
        );

        beneficiaryA.configure(vault);
        beneficiaryB.configure(vault);

        hook.registerPool(poolKey, address(vault));
        manager.initialize(poolKey, SQRT_PRICE_1_1);
        quoteAsset.mint(address(this), 1e36);
        launchedToken.mint(address(this), 1e36);
        quoteAsset.approve(address(modifyLiquidityRouter), type(uint256).max);
        launchedToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        LIQUIDITY_PARAMS = ModifyLiquidityParams({ tickLower: -200, tickUpper: 200, liquidityDelta: 1e24, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity(poolKey, LIQUIDITY_PARAMS, ZERO_BYTES);

        swapHandler = new StockPairedSwapHandler(
            swapRouter, IERC20(address(quoteAsset)), IERC20(address(launchedToken)), poolKey, quoteIsCurrency0
        );
        quoteAsset.mint(address(swapHandler), 1e30);
        launchedToken.mint(address(swapHandler), 1e30);

        bytes4[] memory swapSelectors = new bytes4[](4);
        swapSelectors[0] = StockPairedSwapHandler.buyExactInput.selector;
        swapSelectors[1] = StockPairedSwapHandler.sellExactInput.selector;
        swapSelectors[2] = StockPairedSwapHandler.buyExactOutput.selector;
        swapSelectors[3] = StockPairedSwapHandler.sellExactOutput.selector;
        targetSelector(FuzzSelector({ addr: address(swapHandler), selectors: swapSelectors }));
        targetContract(address(swapHandler));

        bytes4[] memory beneficiarySelectors = new bytes4[](3);
        beneficiarySelectors[0] = StockPairedBeneficiaryHandler.claim.selector;
        beneficiarySelectors[1] = StockPairedBeneficiaryHandler.useFirstPayout.selector;
        beneficiarySelectors[2] = StockPairedBeneficiaryHandler.useSecondPayout.selector;
        targetSelector(FuzzSelector({ addr: address(beneficiaryA), selectors: beneficiarySelectors }));
        targetSelector(FuzzSelector({ addr: address(beneficiaryB), selectors: beneficiarySelectors }));
    }

    function invariant_quoteClaimsExactlyCoverAccruedAccounting() public view {
        uint256 claims = manager.balanceOf(address(hook), Currency.wrap(address(quoteAsset)).toId());
        assertEq(claims, hook.totalQuoteFeesAccrued(address(quoteAsset)));
        assertEq(manager.balanceOf(address(hook), Currency.wrap(address(launchedToken)).toId()), 0);

        (,,,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        assertEq(creatorFees + hook.launcherFeesAccrued(address(quoteAsset)), claims);
    }

    function invariant_feeDisclosureNeverChanges() public view {
        (
            address disclosedQuote,
            address disclosedToken,
            uint16 buyFee,
            uint16 sellFee,
            uint16 creatorFee,
            uint16 launcherFee,
            uint16 transferTax,
            uint24 lpFee,
            address rewardVault
        ) = hook.feeDisclosure(poolId);
        assertEq(disclosedQuote, address(quoteAsset));
        assertEq(disclosedToken, address(launchedToken));
        assertEq(buyFee, 100);
        assertEq(sellFee, 100);
        assertEq(creatorFee, 90);
        assertEq(launcherFee, 10);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(rewardVault, address(vault));
    }

    function invariant_rewardAccountingIsConserved() public view {
        address beneficiaryAddressA = vault.beneficiaryAt(0);
        address beneficiaryAddressB = vault.beneficiaryAt(1);
        uint256 received = vault.totalCreatorFeesReceived();
        uint256 claimedA = vault.claimedBy(beneficiaryAddressA);
        uint256 claimedB = vault.claimedBy(beneficiaryAddressB);
        assertEq(vault.totalCreatorFeesClaimed(), claimedA + claimedB);
        assertEq(
            received, claimedA + claimedB + vault.claimable(beneficiaryAddressA) + vault.claimable(beneficiaryAddressB)
        );
        assertEq(quoteAsset.balanceOf(address(vault)), received - claimedA - claimedB);
        assertEq(vault.shareBpsOf(beneficiaryAddressA), 3333);
        assertEq(vault.shareBpsOf(beneficiaryAddressB), 6667);
    }

    function invariant_hookPermissionsAndLooseBalancesRemainExact() public view {
        assertEq(uint160(address(hook)) & hookFactory.ALL_HOOK_MASK(), hookFactory.REQUIRED_HOOK_FLAGS());
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertEq(quoteAsset.balanceOf(address(hook)), 0);
        assertEq(launchedToken.balanceOf(address(hook)), 0);
    }

    function _addresses(StockPairedInvariantQuoteToken[7] memory assets)
        private
        pure
        returns (address[] memory values)
    {
        values = new address[](7);
        for (uint256 index; index < assets.length; index++) {
            values[index] = address(assets[index]);
        }
    }

    function _symbolHashes(StockPairedInvariantQuoteToken[7] memory assets)
        private
        view
        returns (bytes32[] memory values)
    {
        values = new bytes32[](7);
        for (uint256 index; index < assets.length; index++) {
            values[index] = keccak256(bytes(assets[index].symbol()));
        }
    }
}
