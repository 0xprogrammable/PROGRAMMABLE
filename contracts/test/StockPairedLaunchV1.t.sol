// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IBeacon } from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { CustomRevert } from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { QuoteAssetCreatorFeeHookFactoryV1 } from "../src/QuoteAssetCreatorFeeHookFactoryV1.sol";
import { QuoteAssetCreatorFeeHookV1 } from "../src/QuoteAssetCreatorFeeHookV1.sol";
import { QuoteAssetFeeSplitVaultFactoryV1 } from "../src/QuoteAssetFeeSplitVaultFactoryV1.sol";
import { QuoteAssetFeeSplitVaultV1 } from "../src/QuoteAssetFeeSplitVaultV1.sol";
import {
    IUniswapV3FactoryLike,
    IUniswapV3SwapRouterLike,
    StockPairedEthLaunchCoordinatorV1
} from "../src/StockPairedEthLaunchCoordinatorV1.sol";
import { StockPairedLaunchV1 } from "../src/StockPairedLaunchV1.sol";
import { StockPairedPositionPlannerV1 } from "../src/StockPairedPositionPlannerV1.sol";
import { StockQuoteRegistryV1 } from "../src/StockQuoteRegistryV1.sol";

contract MockStockQuoteToken is ERC20 {
    uint16 public transferFeeBps;
    address public callbackTarget;
    bytes public callbackData;
    bool public lastCallbackSucceeded;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function setTransferFeeBps(uint16 transferFeeBps_) external {
        transferFeeBps = transferFeeBps_;
    }

    function setTransferFromCallback(address callbackTarget_, bytes calldata callbackData_) external {
        callbackTarget = callbackTarget_;
        callbackData = callbackData_;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (callbackTarget != address(0)) {
            (lastCallbackSucceeded,) = callbackTarget.call(callbackData);
        }
        return super.transferFrom(from, to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        uint256 fee = from != address(0) && to != address(0) ? FullMath.mulDiv(value, transferFeeBps, 10_000) : 0;
        if (fee == 0) {
            super._update(from, to, value);
            return;
        }
        super._update(from, to, value - fee);
        super._update(from, address(0), fee);
    }
}

contract MockStockImplementation { }

contract MockStockBeacon is IBeacon {
    address private immutable _implementation;

    constructor(address implementation_) {
        _implementation = implementation_;
    }

    function implementation() external view returns (address) {
        return _implementation;
    }
}

contract MockStockV3Pool { }

contract MockStockV3Factory is IUniswapV3FactoryLike {
    mapping(bytes32 key => address pool) private _pools;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        _pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool) {
        return _pools[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}

contract MockStockV3Router is IUniswapV3SwapRouterLike {
    address public immutable factory;
    address public immutable WETH9;
    uint256 public amountOut;

    error Expired();
    error InsufficientOutput(uint256 actual, uint256 minimum);
    error InvalidEthInput();

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH9 = weth_;
    }

    function setAmountOut(uint256 amountOut_) external {
        amountOut = amountOut_;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256) {
        if (params.deadline < block.timestamp) revert Expired();
        if (msg.value != params.amountIn) revert InvalidEthInput();
        if (amountOut < params.amountOutMinimum) {
            revert InsufficientOutput(amountOut, params.amountOutMinimum);
        }
        address quoteAsset;
        bytes calldata path = params.path;
        assembly ("memory-safe") {
            quoteAsset := shr(96, calldataload(add(path.offset, sub(path.length, 20))))
        }
        MockStockQuoteToken(quoteAsset).mint(params.recipient, amountOut);
        return amountOut;
    }
}

contract StockPairedLaunchV1Test is Deployers {
    using StateLibrary for IPoolManager;

    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    uint256 internal constant INITIAL_BUY = 0.05 ether;
    uint256 internal constant BASIS_POINTS = 10_000;

    PositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    QuoteAssetCreatorFeeHookFactoryV1 internal hookFactory;
    QuoteAssetCreatorFeeHookV1 internal feeHook;
    QuoteAssetFeeSplitVaultFactoryV1 internal vaultFactory;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    StockPairedPositionPlannerV1 internal positionPlanner;
    StockQuoteRegistryV1 internal quoteRegistry;
    StockPairedLaunchV1 internal launcher;

    MockStockQuoteToken[7] internal quoteTokens;
    address internal deployer;
    address internal alice;
    address internal bob;
    address internal treasury;

    PoolSwapTest.TestSettings internal settings =
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

    function setUp() public {
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), CANONICAL_POOL_MANAGER);
        manager = IPoolManager(CANONICAL_POOL_MANAGER);
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            CANONICAL_POSITION_MANAGER
        );
        positionManager = PositionManager(payable(CANONICAL_POSITION_MANAGER));
        swapRouter = new PoolSwapTest(manager);

        quoteTokens[0] = new MockStockQuoteToken("NVIDIA Tokenized Stock", "NVDAon");
        quoteTokens[1] = new MockStockQuoteToken("SPDR S&P 500 Tokenized ETF", "SPYon");
        quoteTokens[2] = new MockStockQuoteToken("Alphabet Tokenized Stock", "GOOGLon");
        quoteTokens[3] = new MockStockQuoteToken("Silver Tokenized Asset", "SLVon");
        quoteTokens[4] = new MockStockQuoteToken("Nasdaq 100 Tokenized ETF", "QQQon");
        quoteTokens[5] = new MockStockQuoteToken("Tesla Tokenized Stock", "TSLAon");
        quoteTokens[6] = new MockStockQuoteToken("Apple Tokenized Stock", "AAPLon");

        MockStockImplementation implementation = new MockStockImplementation();
        MockStockBeacon beacon = new MockStockBeacon(address(implementation));
        quoteRegistry = new StockQuoteRegistryV1(
            _quoteAssetAddresses(),
            _quoteSymbolHashes(),
            address(beacon),
            address(implementation),
            address(quoteTokens[0]).codehash,
            address(beacon).codehash,
            address(implementation).codehash
        );

        tokenFactory = new UERC20Factory();
        hookFactory = new QuoteAssetCreatorFeeHookFactoryV1();
        vaultFactory = new QuoteAssetFeeSplitVaultFactoryV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        positionPlanner = new StockPairedPositionPlannerV1();
        treasury = makeAddr("programmableTreasury");
        feeHook = _deployHook();
        launcher = new StockPairedLaunchV1(
            manager,
            positionManager,
            tokenFactory,
            feeHook,
            quoteRegistry,
            positionPlanner,
            vaultFactory,
            positionForwarderFactory
        );

        deployer = makeAddr("deployer");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        for (uint256 index; index < quoteTokens.length; index++) {
            quoteTokens[index].mint(deployer, 100 ether);
            quoteTokens[index].mint(alice, 100 ether);
            vm.prank(deployer);
            quoteTokens[index].approve(address(launcher), type(uint256).max);
            vm.prank(deployer);
            quoteTokens[index].approve(address(swapRouter), type(uint256).max);
            vm.prank(alice);
            quoteTokens[index].approve(address(swapRouter), type(uint256).max);
        }
    }

    function test_registryPinsExactlySevenReviewedAssetsAndRuntime() public view {
        assertEq(quoteRegistry.assetCount(), 7);
        for (uint256 index; index < quoteTokens.length; index++) {
            address quoteAsset = address(quoteTokens[index]);
            assertEq(quoteRegistry.assetAt(index), quoteAsset);
            assertTrue(quoteRegistry.isSupported(quoteAsset));
            assertTrue(quoteRegistry.assertAssetReady(quoteAsset) != bytes32(0));
        }
    }

    function test_newLaunchesFailClosedWhenAnAssetRuntimeDrifts() public {
        address quoteAsset = address(quoteTokens[0]);
        bytes32 expected = quoteRegistry.expectedTokenCodeHash();
        vm.etch(quoteAsset, hex"00");
        vm.expectRevert(
            abi.encodeWithSelector(
                StockQuoteRegistryV1.InvalidCodeHash.selector, quoteAsset, quoteAsset.codehash, expected
            )
        );
        quoteRegistry.assertAssetReady(quoteAsset);
    }

    function test_launchesAndLocksAOneSidedPositionWithQuoteAsCurrency0() public {
        _assertLaunchLifecycle(true, address(quoteTokens[0]), bytes32("quote-zero"));
    }

    function test_launchesAndLocksAOneSidedPositionWithQuoteAsCurrency1() public {
        _assertLaunchLifecycle(false, address(quoteTokens[1]), bytes32("quote-one"));
    }

    function test_exactInputBuyAndSellChargeOnePercentInQuoteForBothCurrencyOrders() public {
        _assertExactInputEconomics(true, address(quoteTokens[2]), bytes32("economics-zero"));
        _assertExactInputEconomics(false, address(quoteTokens[3]), bytes32("economics-one"));
    }

    function test_exactOutputBuyAndSellChargeOnePercentInQuoteForBothCurrencyOrders() public {
        _assertExactOutputEconomics(true, address(quoteTokens[4]), bytes32("output-zero"));
        _assertExactOutputEconomics(false, address(quoteTokens[5]), bytes32("output-one"));
    }

    function test_creatorSplitClaimsAndTreasuryClaimConserveQuoteFees() public {
        StockPairedLaunchV1.LaunchParameters memory parameters =
            _parametersForOrientation(true, address(quoteTokens[6]), bytes32("split"));
        parameters.rewardBeneficiaries = _addresses2(alice, bob);
        parameters.rewardSharesBps = _shares2(6000, 4000);
        StockPairedLaunchV1.LaunchResult memory result = _launch(parameters);
        QuoteAssetFeeSplitVaultV1 vault = QuoteAssetFeeSplitVaultV1(result.rewardVault);

        uint256 creatorAccrued = _creatorAccrued(result.poolId);
        uint256 protocolAccrued = feeHook.launcherFeesAccrued(result.quoteAsset);
        uint256 aliceBefore = quoteTokens[6].balanceOf(alice);
        uint256 bobBefore = quoteTokens[6].balanceOf(bob);
        uint256 treasuryBefore = quoteTokens[6].balanceOf(treasury);

        vm.prank(alice);
        uint256 aliceClaim = vault.claim();
        vm.prank(bob);
        uint256 bobClaim = vault.claim();
        vm.prank(treasury);
        uint256 treasuryClaim = feeHook.claimLauncherFees(result.quoteAsset);

        assertEq(aliceClaim, FullMath.mulDiv(creatorAccrued, 6000, BASIS_POINTS));
        assertEq(aliceClaim + bobClaim, creatorAccrued);
        assertEq(quoteTokens[6].balanceOf(alice) - aliceBefore, aliceClaim);
        assertEq(quoteTokens[6].balanceOf(bob) - bobBefore, bobClaim);
        assertEq(quoteTokens[6].balanceOf(treasury) - treasuryBefore, treasuryClaim);
        assertEq(treasuryClaim, protocolAccrued);
        assertEq(feeHook.totalQuoteFeesAccrued(result.quoteAsset), 0);
        assertEq(manager.balanceOf(address(feeHook), Currency.wrap(result.quoteAsset).toId()), 0);
    }

    function test_unsupportedQuoteAssetCannotLaunch() public {
        MockStockQuoteToken unsupported = new MockStockQuoteToken("Unsupported", "NOPE");
        StockPairedLaunchV1.LaunchParameters memory parameters =
            _baseParameters("Unsupported quote", "NOPE", address(unsupported), bytes32("unsupported"));
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(StockQuoteRegistryV1.UnsupportedQuoteAsset.selector, address(unsupported))
        );
        launcher.launch(parameters);
    }

    function test_ethCoordinatorRoutesTheInitialBuyAndReturnsAllLaunchedTokensToCreator() public {
        (StockPairedEthLaunchCoordinatorV1 coordinator, MockStockV3Router router) = _deployEthCoordinator();
        uint256 ethInput = 0.001 ether;
        router.setAmountOut(INITIAL_BUY);

        StockPairedLaunchV1.LaunchParameters memory launchParameters =
            _baseParameters("ETH Stock Paired", "ETHSP", address(quoteTokens[0]), bytes32("eth-launch"));
        launchParameters.initialBuyQuoteAmount = 0;
        (address predicted,) = coordinator.predictTokenAddress(
            launchParameters.name, launchParameters.symbol, deployer, launchParameters.creatorSalt
        );
        StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters =
            _ethLaunchParameters(launchParameters, INITIAL_BUY, 1);

        vm.deal(deployer, ethInput);
        vm.prank(deployer);
        StockPairedLaunchV1.LaunchResult memory result = coordinator.launch{ value: ethInput }(parameters);

        assertEq(result.token, predicted);
        assertEq(result.initialBuyQuoteAmount, INITIAL_BUY);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(deployer), result.initialBuyTokenAmount);
        assertEq(IERC20(result.token).balanceOf(address(coordinator)), 0);
        assertEq(quoteTokens[0].balanceOf(address(coordinator)), 0);
        assertEq(quoteTokens[0].allowance(address(coordinator), address(launcher)), 0);
        assertEq(QuoteAssetFeeSplitVaultV1(result.rewardVault).beneficiaryAt(0), deployer);
    }

    function test_ethCoordinatorSeparatesCreatorSaltsAndRequiresOutputProtection() public {
        (StockPairedEthLaunchCoordinatorV1 coordinator, MockStockV3Router router) = _deployEthCoordinator();
        bytes32 salt = bytes32("shared-salt");
        (address deployerToken,) = coordinator.predictTokenAddress("Salt A", "SALTA", deployer, salt);
        (address aliceToken,) = coordinator.predictTokenAddress("Salt A", "SALTA", alice, salt);
        assertNotEq(deployerToken, aliceToken);

        router.setAmountOut(INITIAL_BUY);
        StockPairedLaunchV1.LaunchParameters memory launchParameters =
            _baseParameters("Protected ETH launch", "PROTECT", address(quoteTokens[1]), salt);
        launchParameters.initialBuyQuoteAmount = 0;
        (address protectedToken,) = coordinator.predictTokenAddress(
            launchParameters.name, launchParameters.symbol, deployer, launchParameters.creatorSalt
        );
        StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters =
            _ethLaunchParameters(launchParameters, INITIAL_BUY, type(uint256).max);

        vm.deal(deployer, 0.001 ether);
        parameters.minimumQuoteAmountOut = 0;
        vm.prank(deployer);
        vm.expectRevert(StockPairedEthLaunchCoordinatorV1.QuoteOutputRequired.selector);
        coordinator.launch{ value: 0.001 ether }(parameters);

        parameters.minimumQuoteAmountOut = INITIAL_BUY;
        vm.prank(deployer);
        vm.expectPartialRevert(StockPairedEthLaunchCoordinatorV1.InitialTokenOutputBelowMinimum.selector);
        coordinator.launch{ value: 0.001 ether }(parameters);
        assertEq(protectedToken.code.length, 0);
    }

    function test_ethCoordinatorRejectsUnsupportedRoutesAndReentrancy() public {
        (StockPairedEthLaunchCoordinatorV1 coordinator, MockStockV3Router router) = _deployEthCoordinator();
        MockStockQuoteToken unsupported = new MockStockQuoteToken("Unsupported", "NOPE");
        vm.expectRevert(
            abi.encodeWithSelector(
                StockPairedEthLaunchCoordinatorV1.UnsupportedQuoteAsset.selector, address(unsupported)
            )
        );
        coordinator.routePath(address(unsupported));

        router.setAmountOut(INITIAL_BUY);
        StockPairedLaunchV1.LaunchParameters memory launchParameters =
            _baseParameters("Reentrant ETH launch", "REENT", address(quoteTokens[2]), bytes32("reentrant"));
        launchParameters.initialBuyQuoteAmount = 0;
        StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters =
            _ethLaunchParameters(launchParameters, INITIAL_BUY, 1);
        quoteTokens[2].setTransferFromCallback(
            address(coordinator), abi.encodeCall(StockPairedEthLaunchCoordinatorV1.launch, (parameters))
        );

        vm.deal(deployer, 0.001 ether);
        vm.prank(deployer);
        StockPairedLaunchV1.LaunchResult memory result = coordinator.launch{ value: 0.001 ether }(parameters);
        assertGt(result.initialBuyTokenAmount, 0);
        assertFalse(quoteTokens[2].lastCallbackSucceeded());
    }

    function test_feeOnTransferQuoteAssetFailsBeforeInitialBuy() public {
        quoteTokens[0].setTransferFeeBps(100);
        StockPairedLaunchV1.LaunchParameters memory parameters =
            _parametersForOrientation(true, address(quoteTokens[0]), bytes32("fee-on-transfer"));

        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(StockPairedLaunchV1.InvalidQuoteTransfer.selector, 0.0495 ether, INITIAL_BUY)
        );
        launcher.launch(parameters);
    }

    function test_reentrantQuoteTokenCannotReenterLaunch() public {
        StockPairedLaunchV1.LaunchParameters memory parameters =
            _parametersForOrientation(true, address(quoteTokens[1]), bytes32("reentrancy"));
        quoteTokens[1].setTransferFromCallback(address(launcher), abi.encodeCall(launcher.launch, (parameters)));

        StockPairedLaunchV1.LaunchResult memory result = _launch(parameters);

        assertFalse(quoteTokens[1].lastCallbackSucceeded());
        assertTrue(result.token.code.length > 0);
    }

    function test_untrustedCallersCannotRegisterOrClaimOrRedirectRewards() public {
        StockPairedLaunchV1.LaunchResult memory result =
            _launch(_parametersForOrientation(true, address(quoteTokens[2]), bytes32("unauthorized")));
        PoolKey memory key = launcher.poolKey(result.token, result.quoteAsset);
        QuoteAssetFeeSplitVaultV1 vault = QuoteAssetFeeSplitVaultV1(result.rewardVault);

        vm.startPrank(alice);
        vm.expectPartialRevert(QuoteAssetCreatorFeeHookV1.InvalidRegistrar.selector);
        feeHook.registerPool(key, result.rewardVault);
        vm.expectPartialRevert(QuoteAssetCreatorFeeHookV1.UnauthorizedCreatorClaim.selector);
        feeHook.claimCreatorFees(result.poolId);
        vm.expectPartialRevert(QuoteAssetCreatorFeeHookV1.UnauthorizedFeeRedirect.selector);
        feeHook.claimLauncherFees(result.quoteAsset);
        vm.expectPartialRevert(QuoteAssetFeeSplitVaultV1.UnauthorizedBeneficiary.selector);
        vault.setPayoutAddress(alice);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectPartialRevert(StockPairedLaunchV1.UnauthorizedUnlockCallback.selector);
        launcher.unlockCallback("");
    }

    function test_partialFillsFailClosedForBothCurrencyOrders() public {
        _assertPartialFillFailsClosed(true, address(quoteTokens[3]), bytes32("partial-zero"));
        _assertPartialFillFailsClosed(false, address(quoteTokens[4]), bytes32("partial-one"));
    }

    function test_constructorRejectsAnUnreviewedPositionPlannerRuntime() public {
        MockStockImplementation wrongPlanner = new MockStockImplementation();

        vm.expectPartialRevert(StockPairedLaunchV1.InvalidPositionPlanner.selector);
        new StockPairedLaunchV1(
            manager,
            positionManager,
            tokenFactory,
            feeHook,
            quoteRegistry,
            StockPairedPositionPlannerV1(address(wrongPlanner)),
            vaultFactory,
            positionForwarderFactory
        );
    }

    function testFuzz_feeMathAlwaysChargesExactlyTheDisclosedTotal(uint128 grossInput, uint128 netOutput) public view {
        (uint256 grossCreator, uint256 grossLauncher) = feeHook.quoteGrossFees(grossInput);
        uint256 expectedGrossTotal = FullMath.mulDiv(grossInput, 100, BASIS_POINTS);
        assertEq(grossCreator + grossLauncher, expectedGrossTotal);
        assertEq(grossLauncher, FullMath.mulDiv(grossInput, 10, BASIS_POINTS));

        (uint256 netCreator, uint256 netLauncher) = feeHook.quoteExactOutputFees(netOutput);
        uint256 grossForExactOutput = FullMath.mulDivRoundingUp(netOutput, BASIS_POINTS, BASIS_POINTS - 100);
        assertEq(netCreator + netLauncher, grossForExactOutput - netOutput);
        assertEq(netLauncher, FullMath.mulDiv(grossForExactOutput, 10, BASIS_POINTS));
    }

    function _assertLaunchLifecycle(bool quoteIsCurrency0, address quoteAsset, bytes32 salt) private {
        StockPairedLaunchV1.LaunchResult memory result =
            _launch(_parametersForOrientation(quoteIsCurrency0, quoteAsset, salt));
        PoolKey memory key = launcher.poolKey(result.token, quoteAsset);
        QuoteAssetFeeSplitVaultV1 vault = QuoteAssetFeeSplitVaultV1(result.rewardVault);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(result.quoteIsCurrency0, quoteIsCurrency0);
        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(result.initialTick, quoteIsCurrency0 ? int24(191_200) : int24(-191_200));
        assertEq(result.quoteConfigurationHash, quoteRegistry.assertAssetReady(quoteAsset));
        assertEq(result.initialBuyQuoteAmount, INITIAL_BUY);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(deployer), result.initialBuyTokenAmount);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(address(positionManager)), 0);
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(UERC20(result.token).creator(), address(launcher));
        assertEq(launcher.rewardVaultOf(result.token), result.rewardVault);
        assertEq(launcher.quoteAssetOf(result.token), quoteAsset);
        assertEq(address(vault.quoteAsset()), quoteAsset);
        assertEq(vault.beneficiaryAt(0), deployer);
        assertEq(vault.shareBpsOf(deployer), 10_000);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), deployer);
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();

        _assertDisclosure(result);
    }

    function _assertDisclosure(StockPairedLaunchV1.LaunchResult memory result) private view {
        (
            address disclosedQuote,
            address launchedToken,
            uint16 buyFee,
            uint16 sellFee,
            uint16 creatorFee,
            uint16 launcherFee,
            uint16 transferTax,
            uint24 lpFee,
            address rewardVault
        ) = feeHook.feeDisclosure(result.poolId);
        assertEq(disclosedQuote, result.quoteAsset);
        assertEq(launchedToken, result.token);
        assertEq(buyFee, 100);
        assertEq(sellFee, 100);
        assertEq(creatorFee, 90);
        assertEq(launcherFee, 10);
        assertEq(transferTax, 0);
        assertEq(lpFee, 0);
        assertEq(rewardVault, result.rewardVault);
    }

    function _assertExactInputEconomics(bool quoteIsCurrency0, address quoteAsset, bytes32 salt) private {
        StockPairedLaunchV1.LaunchResult memory result =
            _launch(_parametersForOrientation(quoteIsCurrency0, quoteAsset, salt));
        PoolKey memory key = launcher.poolKey(result.token, quoteAsset);
        vm.prank(deployer);
        IERC20(result.token).approve(address(swapRouter), type(uint256).max);
        _assertExactInputBuy(result, key);
        _assertExactInputSell(result, key);
        _assertHookLiabilities(result.poolId, quoteAsset);
    }

    function _assertExactInputBuy(StockPairedLaunchV1.LaunchResult memory result, PoolKey memory key) private {
        uint256 creatorBefore = _creatorAccrued(result.poolId);
        uint256 launcherBefore = feeHook.launcherFeesAccrued(result.quoteAsset);
        uint256 grossBuy = 0.02 ether;
        vm.prank(alice);
        BalanceDelta buyDelta = _swap(
            key,
            result.quoteIsCurrency0,
            -int256(grossBuy),
            result.quoteIsCurrency0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        );
        (uint256 expectedBuyCreator, uint256 expectedBuyLauncher) = feeHook.quoteGrossFees(grossBuy);
        assertGt(_tokenDelta(buyDelta, result.quoteIsCurrency0), 0);
        assertEq(_creatorAccrued(result.poolId) - creatorBefore, expectedBuyCreator);
        assertEq(feeHook.launcherFeesAccrued(result.quoteAsset) - launcherBefore, expectedBuyLauncher);
    }

    function _assertExactInputSell(StockPairedLaunchV1.LaunchResult memory result, PoolKey memory key) private {
        uint256 creatorBefore = _creatorAccrued(result.poolId);
        uint256 launcherBefore = feeHook.launcherFeesAccrued(result.quoteAsset);
        uint256 tokenInput = result.initialBuyTokenAmount / 10;
        vm.prank(deployer);
        BalanceDelta sellDelta = _swap(
            key,
            !result.quoteIsCurrency0,
            -int256(tokenInput),
            result.quoteIsCurrency0 ? TickMath.MAX_SQRT_PRICE - 1 : TickMath.MIN_SQRT_PRICE + 1
        );
        uint256 creatorIncrement = _creatorAccrued(result.poolId) - creatorBefore;
        uint256 launcherIncrement = feeHook.launcherFeesAccrued(result.quoteAsset) - launcherBefore;
        uint256 netQuoteOutput = _quoteDelta(sellDelta, result.quoteIsCurrency0);
        uint256 grossQuoteOutput = netQuoteOutput + creatorIncrement + launcherIncrement;
        (uint256 expectedSellCreator, uint256 expectedSellLauncher) = feeHook.quoteGrossFees(grossQuoteOutput);
        assertEq(creatorIncrement, expectedSellCreator);
        assertEq(launcherIncrement, expectedSellLauncher);
    }

    function _assertExactOutputEconomics(bool quoteIsCurrency0, address quoteAsset, bytes32 salt) private {
        StockPairedLaunchV1.LaunchResult memory result =
            _launch(_parametersForOrientation(quoteIsCurrency0, quoteAsset, salt));
        PoolKey memory key = launcher.poolKey(result.token, quoteAsset);
        vm.prank(deployer);
        IERC20(result.token).approve(address(swapRouter), type(uint256).max);

        {
            uint256 creatorBefore = _creatorAccrued(result.poolId);
            uint256 launcherBefore = feeHook.launcherFeesAccrued(quoteAsset);
            vm.prank(alice);
            _swap(
                key,
                quoteIsCurrency0,
                int256(1 ether),
                quoteIsCurrency0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            );
            assertGt(_creatorAccrued(result.poolId) - creatorBefore, 0);
            assertGt(feeHook.launcherFeesAccrued(quoteAsset) - launcherBefore, 0);
        }

        {
            uint256 creatorBefore = _creatorAccrued(result.poolId);
            uint256 launcherBefore = feeHook.launcherFeesAccrued(quoteAsset);
            uint256 netQuoteOutput = 0.001 ether;
            vm.prank(deployer);
            BalanceDelta sellDelta = _swap(
                key,
                !quoteIsCurrency0,
                int256(netQuoteOutput),
                quoteIsCurrency0 ? TickMath.MAX_SQRT_PRICE - 1 : TickMath.MIN_SQRT_PRICE + 1
            );
            (uint256 expectedCreator, uint256 expectedLauncher) = feeHook.quoteExactOutputFees(netQuoteOutput);
            assertEq(_quoteDelta(sellDelta, quoteIsCurrency0), netQuoteOutput);
            assertEq(_creatorAccrued(result.poolId) - creatorBefore, expectedCreator);
            assertEq(feeHook.launcherFeesAccrued(quoteAsset) - launcherBefore, expectedLauncher);
        }
        _assertHookLiabilities(result.poolId, quoteAsset);
    }

    function _assertPartialFillFailsClosed(bool quoteIsCurrency0, address quoteAsset, bytes32 salt) private {
        StockPairedLaunchV1.LaunchResult memory result =
            _launch(_parametersForOrientation(quoteIsCurrency0, quoteAsset, salt));
        PoolKey memory key = launcher.poolKey(result.token, quoteAsset);
        (uint160 currentSqrtPriceX96,,,) = manager.getSlot0(key.toId());
        uint160 partialFillLimit = quoteIsCurrency0 ? currentSqrtPriceX96 - 1 : currentSqrtPriceX96 + 1;

        vm.prank(alice);
        vm.expectPartialRevert(CustomRevert.WrappedError.selector);
        _swap(key, quoteIsCurrency0, -int256(1 ether), partialFillLimit);
    }

    function _assertHookLiabilities(bytes32 poolId, address quoteAsset) private view {
        uint256 liabilities = _creatorAccrued(poolId) + feeHook.launcherFeesAccrued(quoteAsset);
        assertEq(feeHook.totalQuoteFeesAccrued(quoteAsset), liabilities);
        assertEq(manager.balanceOf(address(feeHook), Currency.wrap(quoteAsset).toId()), liabilities);
    }

    function _deployHook() private returns (QuoteAssetCreatorFeeHookV1 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(QuoteAssetCreatorFeeHookV1).creationCode,
            abi.encode(manager, treasury, quoteRegistry, vaultFactory)
        );
        deployed = hookFactory.deploy(salt, manager, treasury, quoteRegistry, vaultFactory);
    }

    function _deployEthCoordinator()
        private
        returns (StockPairedEthLaunchCoordinatorV1 coordinator, MockStockV3Router router)
    {
        MockStockQuoteToken weth = new MockStockQuoteToken("Wrapped Ether", "WETH");
        MockStockQuoteToken usdc = new MockStockQuoteToken("USD Coin", "USDC");
        MockStockV3Factory factory = new MockStockV3Factory();
        router = new MockStockV3Router(address(factory), address(weth));
        MockStockV3Pool pool = new MockStockV3Pool();
        factory.setPool(address(weth), address(usdc), 500, address(pool));

        address[] memory assets = _quoteAssetAddresses();
        uint24[] memory fees = new uint24[](assets.length);
        for (uint256 index; index < assets.length; index++) {
            fees[index] = 10_000;
            factory.setPool(address(usdc), assets[index], fees[index], address(pool));
        }
        coordinator = new StockPairedEthLaunchCoordinatorV1(
            launcher, router, factory, address(weth), address(usdc), assets, fees
        );
    }

    function _ethLaunchParameters(
        StockPairedLaunchV1.LaunchParameters memory launchParameters,
        uint256 minimumQuoteAmountOut,
        uint256 minimumInitialTokenOut
    ) private view returns (StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters) {
        parameters = StockPairedEthLaunchCoordinatorV1.EthLaunchParameters({
            minimumQuoteAmountOut: minimumQuoteAmountOut,
            minimumInitialTokenOut: minimumInitialTokenOut,
            deadline: block.timestamp + 1 hours,
            launch: launchParameters
        });
    }

    function _launch(StockPairedLaunchV1.LaunchParameters memory parameters)
        private
        returns (StockPairedLaunchV1.LaunchResult memory result)
    {
        vm.prank(deployer);
        result = launcher.launch(parameters);
    }

    function _parametersForOrientation(bool quoteIsCurrency0, address quoteAsset, bytes32 salt)
        private
        view
        returns (StockPairedLaunchV1.LaunchParameters memory parameters)
    {
        for (uint256 nonce; nonce < 2048; nonce++) {
            string memory suffix = vm.toString(nonce);
            string memory name = string.concat("Stock Paired ", suffix);
            string memory symbol = string.concat("SP", suffix);
            bytes32 candidateSalt = keccak256(abi.encode(salt, nonce));
            (address token,) = launcher.predictTokenAddress(name, symbol, deployer, candidateSalt);
            if ((quoteAsset < token) == quoteIsCurrency0) {
                return _baseParameters(name, symbol, quoteAsset, candidateSalt);
            }
        }
        revert("orientation not found");
    }

    function _baseParameters(string memory name, string memory symbol, address quoteAsset, bytes32 salt)
        private
        view
        returns (StockPairedLaunchV1.LaunchParameters memory parameters)
    {
        parameters = StockPairedLaunchV1.LaunchParameters({
            name: name,
            symbol: symbol,
            quoteAsset: quoteAsset,
            initialBuyQuoteAmount: INITIAL_BUY,
            creatorSalt: salt,
            metadata: UERC20Metadata({
                description: "Stock Paired launch fixture",
                website: "https://programmable.family",
                image: "ipfs://stock-paired",
                extraData: bytes("")
            }),
            rewardBeneficiaries: _addresses1(deployer),
            rewardSharesBps: _shares1(10_000)
        });
    }

    function _swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96)
        private
        returns (BalanceDelta)
    {
        return swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            settings,
            ""
        );
    }

    function _creatorAccrued(bytes32 poolId) private view returns (uint256 accrued) {
        (,,,,,, accrued) = feeHook.poolFeeConfig(poolId);
    }

    function _quoteDelta(BalanceDelta delta, bool quoteIsCurrency0) private pure returns (uint256) {
        int128 raw = quoteIsCurrency0 ? delta.amount0() : delta.amount1();
        return uint256(int256(raw));
    }

    function _tokenDelta(BalanceDelta delta, bool quoteIsCurrency0) private pure returns (int128) {
        return quoteIsCurrency0 ? delta.amount1() : delta.amount0();
    }

    function _quoteAssetAddresses() private view returns (address[] memory assets) {
        assets = new address[](7);
        for (uint256 index; index < quoteTokens.length; index++) {
            assets[index] = address(quoteTokens[index]);
        }
    }

    function _quoteSymbolHashes() private view returns (bytes32[] memory hashes) {
        hashes = new bytes32[](7);
        for (uint256 index; index < quoteTokens.length; index++) {
            hashes[index] = keccak256(bytes(quoteTokens[index].symbol()));
        }
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
