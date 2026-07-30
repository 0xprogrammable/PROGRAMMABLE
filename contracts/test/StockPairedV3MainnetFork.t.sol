// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { QuoteAssetCreatorFeeHookFactoryV1 } from "../src/QuoteAssetCreatorFeeHookFactoryV1.sol";
import { QuoteAssetCreatorFeeHookV1 } from "../src/QuoteAssetCreatorFeeHookV1.sol";
import { QuoteAssetFeeSplitVaultFactoryV1 } from "../src/QuoteAssetFeeSplitVaultFactoryV1.sol";
import { QuoteAssetFeeSplitVaultV1 } from "../src/QuoteAssetFeeSplitVaultV1.sol";
import {
    IUniswapV3FactoryLikeV3,
    IUniswapV3SwapRouterLikeV3,
    StockPairedEthLaunchCoordinatorV3
} from "../src/StockPairedEthLaunchCoordinatorV3.sol";
import { StockPairedLaunchV3 } from "../src/StockPairedLaunchV3.sol";
import { StockPairedPositionPlannerV3 } from "../src/StockPairedPositionPlannerV3.sol";
import { StockQuoteRegistryV1 } from "../src/StockQuoteRegistryV1.sol";

interface IStockPairedV3ForkUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IStockPairedV3ForkPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

struct StockPairedV3ForkExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    uint256 minHopPriceX36;
    bytes hookData;
}

contract StockPairedV3MainnetForkTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_642_460;
    uint256 internal constant INITIAL_BUY = 0.02 ether;
    uint256 internal constant TRADER_BUY = 0.005 ether;
    uint8 internal constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant SETTLE_ALL = 0x0c;
    uint8 internal constant TAKE_ALL = 0x0f;
    uint8 internal constant UR_V4_SWAP = 0x10;

    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant UNIVERSAL_ROUTER = 0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address internal constant POSITION_FORWARDER_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;
    address internal constant V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address internal constant V3_SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant WETH_USDC_POOL = 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640;

    address internal constant ONDO_BEACON = 0x985462C9aA4D6c3Ad59Ae6e1e9c0C11347ED1598;
    address internal constant ONDO_IMPLEMENTATION = 0xebBcb2cEE51c2FeE4062c9C1270dcb98B0b22250;

    bytes32 internal constant TOKEN_CODE_HASH = 0x9806c8207a455c012b2799be651ac0146d54866f92db90b502e5e2efa283bee9;
    bytes32 internal constant BEACON_CODE_HASH = 0xfeff50d5e739b863fc9e0db874d5558375a3e2c81bc20c24923a685263d639bd;
    bytes32 internal constant IMPLEMENTATION_CODE_HASH =
        0x7480293a8fad3f98f01f39aa59cd4e4c30d7fc4e7019e8f6e691eb5a9be53d11;
    bytes32 internal constant POOL_MANAGER_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 internal constant POSITION_MANAGER_CODE_HASH =
        0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b;
    bytes32 internal constant V4_QUOTER_CODE_HASH = 0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441;
    bytes32 internal constant PERMIT2_CODE_HASH = 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131;
    bytes32 internal constant UNIVERSAL_ROUTER_CODE_HASH =
        0x70c9ea2b275087aea3d57ae48e2d30e272a07ff5b6c7974bd47c21478b37face;
    bytes32 internal constant UERC20_FACTORY_CODE_HASH =
        0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb;
    bytes32 internal constant POSITION_FORWARDER_FACTORY_CODE_HASH =
        0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2;
    bytes32 internal constant V3_FACTORY_CODE_HASH = 0x4d7b8525cd5d14343fa67a732fba5b24cddba11620ca88392f4ec6c52f91fd69;
    bytes32 internal constant V3_SWAP_ROUTER_CODE_HASH =
        0xbb90113d2f9a5e9b7feb15a1d1fff06c1ee1575b3f9b1181778ffd0cf633e7ea;
    bytes32 internal constant WETH_CODE_HASH = 0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23;
    bytes32 internal constant USDC_CODE_HASH = 0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505;
    bytes32 internal constant WETH_USDC_POOL_CODE_HASH =
        0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4;

    IPoolManager internal poolManager;
    StockQuoteRegistryV1 internal quoteRegistry;
    QuoteAssetCreatorFeeHookV1 internal feeHook;
    StockPairedLaunchV3 internal launcher;

    address internal creator;
    address internal trader;
    address internal treasury;

    function setUp() public {
        vm.createSelectFork(vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org")), SNAPSHOT_BLOCK);

        poolManager = IPoolManager(POOL_MANAGER);
        creator = makeAddr("stockPairedV3ForkCreator");
        trader = makeAddr("stockPairedV3ForkTrader");
        treasury = makeAddr("stockPairedV3ForkTreasury");

        quoteRegistry = new StockQuoteRegistryV1(
            _allRegistryAssets(),
            _allRegistrySymbolHashes(),
            ONDO_BEACON,
            ONDO_IMPLEMENTATION,
            TOKEN_CODE_HASH,
            BEACON_CODE_HASH,
            IMPLEMENTATION_CODE_HASH
        );

        QuoteAssetFeeSplitVaultFactoryV1 vaultFactory = new QuoteAssetFeeSplitVaultFactoryV1();
        QuoteAssetCreatorFeeHookFactoryV1 hookFactory = new QuoteAssetCreatorFeeHookFactoryV1();
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(QuoteAssetCreatorFeeHookV1).creationCode,
            abi.encode(poolManager, treasury, quoteRegistry, vaultFactory)
        );
        feeHook = hookFactory.deploy(hookSalt, poolManager, treasury, quoteRegistry, vaultFactory);
        launcher = new StockPairedLaunchV3(
            poolManager,
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            feeHook,
            quoteRegistry,
            new StockPairedPositionPlannerV3(),
            vaultFactory,
            LockedPositionFeeForwarderFactoryV1(POSITION_FORWARDER_FACTORY),
            _priceConfiguration()
        );
    }

    function test_officialDependenciesQuoteAssetsAndRoutesMatchPinnedRuntime() public view {
        assertEq(block.chainid, 1);
        assertEq(block.number, SNAPSHOT_BLOCK);
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_CODE_HASH);
        assertEq(POSITION_MANAGER.codehash, POSITION_MANAGER_CODE_HASH);
        assertEq(V4_QUOTER.codehash, V4_QUOTER_CODE_HASH);
        assertEq(PERMIT2.codehash, PERMIT2_CODE_HASH);
        assertEq(UNIVERSAL_ROUTER.codehash, UNIVERSAL_ROUTER_CODE_HASH);
        assertEq(UERC20_FACTORY.codehash, UERC20_FACTORY_CODE_HASH);
        assertEq(POSITION_FORWARDER_FACTORY.codehash, POSITION_FORWARDER_FACTORY_CODE_HASH);
        assertEq(V3_FACTORY.codehash, V3_FACTORY_CODE_HASH);
        assertEq(V3_SWAP_ROUTER.codehash, V3_SWAP_ROUTER_CODE_HASH);
        assertEq(WETH.codehash, WETH_CODE_HASH);
        assertEq(USDC.codehash, USDC_CODE_HASH);
        assertEq(WETH_USDC_POOL.codehash, WETH_USDC_POOL_CODE_HASH);
        assertEq(ONDO_BEACON.codehash, BEACON_CODE_HASH);
        assertEq(ONDO_IMPLEMENTATION.codehash, IMPLEMENTATION_CODE_HASH);

        address[] memory registryAssets = _allRegistryAssets();
        bytes32[] memory symbols = _allRegistrySymbolHashes();
        assertEq(quoteRegistry.assetCount(), registryAssets.length);
        for (uint256 index; index < registryAssets.length; index++) {
            address asset = registryAssets[index];
            assertEq(asset.codehash, TOKEN_CODE_HASH);
            assertEq(IERC20Metadata(asset).decimals(), 18);
            assertEq(keccak256(bytes(IERC20Metadata(asset).symbol())), symbols[index]);
            assertTrue(quoteRegistry.assertAssetReady(asset) != bytes32(0));
        }

        address[6] memory routePools = _routePools();
        bytes32[6] memory routeCodeHashes = _routePoolCodeHashes();
        address[6] memory configuredAssets = _configuredAssets();
        uint24[6] memory routeFees = _routeFeesFixed();
        for (uint256 index; index < configuredAssets.length; index++) {
            address resolved =
                IUniswapV3FactoryLikeV3(V3_FACTORY).getPool(USDC, configuredAssets[index], routeFees[index]);
            assertEq(resolved, routePools[index]);
            assertEq(resolved.codehash, routeCodeHashes[index]);
        }
    }

    function test_exactPriceTableLaunchesAllSixAssetsAcrossBothOrientationsAndPermanentlyLocksLp() public {
        address[6] memory assets = _configuredAssets();
        int24[6] memory ticks = _configuredTicks();
        for (uint256 index; index < assets.length; index++) {
            assertEq(_launcherQuoteAssetAt(index), assets[index]);
            assertEq(launcher.initialAbsoluteTickFor(assets[index]), ticks[index]);

            StockPairedLaunchV3.LaunchResult memory quote0 =
                _launchForOrientation(index, assets[index], true, bytes32("v3-mainnet-quote0"));
            _assertAtomicLaunchAndPermanentLock(quote0, assets[index], ticks[index], true, creator);

            StockPairedLaunchV3.LaunchResult memory quote1 =
                _launchForOrientation(index, assets[index], false, bytes32("v3-mainnet-quote1"));
            _assertAtomicLaunchAndPermanentLock(quote1, assets[index], ticks[index], false, creator);
        }
    }

    function test_qqqFailsClosedForDirectAndEthLaunchWithoutPartialState() public {
        address qqq = _allRegistryAssets()[4];
        StockPairedLaunchV3.LaunchParameters memory parameters =
            _baseParameters("QQQ V3 route guard", "NOQQQ", qqq, bytes32("qqq-v3-mainnet"));
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        deal(qqq, creator, 1 ether, true);
        vm.prank(creator);
        IERC20(qqq).approve(address(launcher), INITIAL_BUY);

        vm.expectRevert(abi.encodeWithSelector(StockPairedLaunchV3.UnsupportedPriceConfiguration.selector, qqq));
        launcher.initialAbsoluteTickFor(qqq);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(StockPairedLaunchV3.UnsupportedPriceConfiguration.selector, qqq));
        launcher.launch(parameters);

        assertEq(predictedToken.code.length, 0);
        assertEq(launcher.launchHashOf(predictedToken), bytes32(0));
        assertEq(launcher.rewardVaultOf(predictedToken), address(0));
        assertEq(launcher.quoteAssetOf(predictedToken), address(0));

        StockPairedEthLaunchCoordinatorV3 coordinator = _deployEthCoordinator();
        vm.expectRevert(abi.encodeWithSelector(StockPairedEthLaunchCoordinatorV3.UnsupportedQuoteAsset.selector, qqq));
        coordinator.routePath(qqq);
    }

    function test_ethCoordinatorCompletesAtomicSlvRouteCanary() public {
        StockPairedEthLaunchCoordinatorV3 coordinator = _deployEthCoordinator();
        address slv = _configuredAssets()[3];
        StockPairedLaunchV3.LaunchParameters memory launchParameters =
            _baseParameters("Stock Paired V3 ETH canary", "SPV3ETH", slv, bytes32("slv-v3-eth-canary"));
        launchParameters.initialBuyQuoteAmount = 0;
        StockPairedEthLaunchCoordinatorV3.EthLaunchParameters memory parameters =
            StockPairedEthLaunchCoordinatorV3.EthLaunchParameters({
                minimumQuoteAmountOut: 1,
                minimumInitialTokenOut: 1,
                deadline: block.timestamp + 1 hours,
                launch: launchParameters
            });

        vm.deal(creator, 0.0006 ether);
        vm.prank(creator);
        StockPairedLaunchV3.LaunchResult memory result = coordinator.launch{ value: 0.0006 ether }(parameters);

        assertEq(result.quoteAsset, slv);
        assertEq(result.initialTick, -launcher.initialAbsoluteTickFor(slv));
        assertGt(result.initialBuyQuoteAmount, launcher.MIN_INITIAL_BUY_QUOTE_AMOUNT());
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(IERC20(result.token).balanceOf(address(coordinator)), 0);
        assertEq(IERC20(slv).balanceOf(address(coordinator)), 0);
        // The coordinator is the launcher caller and therefore the immutable position fee recipient.
        // LP_FEE_PIPS is zero; creator economics are routed through the configured reward-vault beneficiary.
        assertEq(QuoteAssetFeeSplitVaultV1(result.rewardVault).beneficiaryAt(0), creator);
        _assertAtomicLaunchAndPermanentLock(
            result, slv, launcher.initialAbsoluteTickFor(slv), false, address(coordinator)
        );
    }

    function test_officialQuoterRouterFeeAccrualAndClaimsCompleteLifecycle() public {
        address quoteAsset = _configuredAssets()[0];
        StockPairedLaunchV3.LaunchResult memory result =
            _launchForOrientation(20, quoteAsset, false, bytes32("v3-mainnet-fees"));
        _tradeRoundTrip(result);
        _assertAndClaimAllFees(result);
    }

    function _tradeRoundTrip(StockPairedLaunchV3.LaunchResult memory result) private {
        address quoteAsset = result.quoteAsset;
        PoolKey memory key = launcher.poolKey(result.token, quoteAsset);

        deal(quoteAsset, trader, 1 ether, true);
        _approveRouter(trader, quoteAsset);
        uint256 quotedBuy = _quoteExactInput(key, result.quoteIsCurrency0, TRADER_BUY);
        _executeExactInput(
            trader,
            key,
            result.quoteIsCurrency0,
            quoteAsset,
            result.token,
            _asUint128(TRADER_BUY),
            _asUint128(quotedBuy * 99 / 100)
        );
        uint256 traderTokens = IERC20(result.token).balanceOf(trader);
        assertGt(traderTokens, 0);

        _approveRouter(trader, result.token);
        uint256 sellAmount = traderTokens / 2;
        uint256 quotedSell = _quoteExactInput(key, !result.quoteIsCurrency0, sellAmount);
        uint256 quoteBefore = IERC20(quoteAsset).balanceOf(trader);
        _executeExactInput(
            trader,
            key,
            !result.quoteIsCurrency0,
            result.token,
            quoteAsset,
            _asUint128(sellAmount),
            _asUint128(quotedSell * 99 / 100)
        );
        assertGt(IERC20(quoteAsset).balanceOf(trader) - quoteBefore, 0);
    }

    function _assertAndClaimAllFees(StockPairedLaunchV3.LaunchResult memory result) private {
        address quoteAsset = result.quoteAsset;
        (,,,,,, uint256 creatorFees) = feeHook.poolFeeConfig(result.poolId);
        uint256 protocolFees = feeHook.launcherFeesAccrued(quoteAsset);
        assertGt(creatorFees, 0);
        assertGt(protocolFees, 0);
        assertEq(feeHook.totalQuoteFeesAccrued(quoteAsset), creatorFees + protocolFees);
        assertEq(poolManager.balanceOf(address(feeHook), Currency.wrap(quoteAsset).toId()), creatorFees + protocolFees);

        uint256 creatorBefore = IERC20(quoteAsset).balanceOf(creator);
        vm.prank(creator);
        uint256 creatorClaimed = QuoteAssetFeeSplitVaultV1(result.rewardVault).claim();
        assertEq(creatorClaimed, creatorFees);
        assertEq(IERC20(quoteAsset).balanceOf(creator) - creatorBefore, creatorFees);

        uint256 treasuryBefore = IERC20(quoteAsset).balanceOf(treasury);
        vm.prank(treasury);
        uint256 treasuryClaimed = feeHook.claimLauncherFees(quoteAsset);
        assertEq(treasuryClaimed, protocolFees);
        assertEq(IERC20(quoteAsset).balanceOf(treasury) - treasuryBefore, protocolFees);
        assertEq(feeHook.totalQuoteFeesAccrued(quoteAsset), 0);
        assertEq(poolManager.balanceOf(address(feeHook), Currency.wrap(quoteAsset).toId()), 0);
    }

    function _assertAtomicLaunchAndPermanentLock(
        StockPairedLaunchV3.LaunchResult memory result,
        address quoteAsset,
        int24 absoluteTick,
        bool quoteIsCurrency0,
        address expectedPositionFeeRecipient
    ) private {
        PoolKey memory key = launcher.poolKey(result.token, quoteAsset);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(result.quoteAsset, quoteAsset);
        assertEq(result.quoteIsCurrency0, quoteIsCurrency0);
        assertEq(result.initialTick, quoteIsCurrency0 ? absoluteTick : -absoluteTick);
        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(result.quoteConfigurationHash, quoteRegistry.assertAssetReady(quoteAsset));
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(POSITION_MANAGER), 0);
        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), expectedPositionFeeRecipient);
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();
    }

    function _deployEthCoordinator() private returns (StockPairedEthLaunchCoordinatorV3 coordinator) {
        address[] memory assets = _configuredAssetList();
        uint24[] memory fees = _routeFees();
        coordinator = new StockPairedEthLaunchCoordinatorV3(
            launcher,
            IUniswapV3SwapRouterLikeV3(V3_SWAP_ROUTER),
            IUniswapV3FactoryLikeV3(V3_FACTORY),
            WETH,
            USDC,
            assets,
            fees
        );
    }

    function _launchForOrientation(uint256 index, address quoteAsset, bool quoteIsCurrency0, bytes32 domain)
        private
        returns (StockPairedLaunchV3.LaunchResult memory result)
    {
        StockPairedLaunchV3.LaunchParameters memory parameters =
            _parametersForOrientation(index, quoteAsset, quoteIsCurrency0, domain);
        deal(quoteAsset, creator, 1 ether, true);
        vm.prank(creator);
        IERC20(quoteAsset).approve(address(launcher), INITIAL_BUY);
        vm.prank(creator);
        result = launcher.launch(parameters);
    }

    function _parametersForOrientation(uint256 index, address quoteAsset, bool quoteIsCurrency0, bytes32 domain)
        private
        view
        returns (StockPairedLaunchV3.LaunchParameters memory parameters)
    {
        for (uint256 nonce; nonce < 4096; nonce++) {
            string memory suffix = string.concat(vm.toString(index), vm.toString(nonce));
            string memory name = string.concat("Stock Paired V3 ", suffix);
            string memory symbol = string.concat("SPV3", suffix);
            bytes32 candidateSalt = keccak256(abi.encode(domain, index, nonce));
            (address token,) = launcher.predictTokenAddress(name, symbol, creator, candidateSalt);
            if ((quoteAsset < token) == quoteIsCurrency0) {
                return _baseParameters(name, symbol, quoteAsset, candidateSalt);
            }
        }
        revert("orientation not found");
    }

    function _baseParameters(string memory name, string memory symbol, address quoteAsset, bytes32 salt)
        private
        view
        returns (StockPairedLaunchV3.LaunchParameters memory parameters)
    {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        parameters = StockPairedLaunchV3.LaunchParameters({
            name: name,
            symbol: symbol,
            quoteAsset: quoteAsset,
            initialBuyQuoteAmount: INITIAL_BUY,
            creatorSalt: salt,
            metadata: UERC20Metadata({
                description: "Pinned Stock Paired V3 Mainnet fork fixture",
                website: "https://programmable.family",
                image: "",
                extraData: ""
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares
        });
    }

    function _approveRouter(address owner, address token) private {
        vm.startPrank(owner);
        IERC20(token).approve(PERMIT2, type(uint256).max);
        IStockPairedV3ForkPermit2(PERMIT2).approve(token, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
        vm.stopPrank();
    }

    function _quoteExactInput(PoolKey memory key, bool zeroForOne, uint256 amountIn)
        private
        returns (uint256 amountOut)
    {
        (amountOut,) = IV4Quoter(V4_QUOTER)
            .quoteExactInputSingle(
                IV4Quoter.QuoteExactSingleParams({
                poolKey: key, zeroForOne: zeroForOne, exactAmount: _asUint128(amountIn), hookData: ""
            })
            );
        assertGt(amountOut, 0);
    }

    function _executeExactInput(
        address caller,
        PoolKey memory key,
        bool zeroForOne,
        address inputCurrency,
        address outputCurrency,
        uint128 amountIn,
        uint128 amountOutMinimum
    ) private {
        StockPairedV3ForkExactInputSingleParams memory swap =
            StockPairedV3ForkExactInputSingleParams({
                poolKey: key,
                zeroForOne: zeroForOne,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                minHopPriceX36: 0,
                hookData: ""
            });
        bytes[] memory actionParameters = new bytes[](3);
        actionParameters[0] = abi.encode(swap);
        actionParameters[1] = abi.encode(inputCurrency, uint256(amountIn));
        actionParameters[2] = abi.encode(outputCurrency, uint256(amountOutMinimum));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL), actionParameters);

        vm.prank(caller);
        IStockPairedV3ForkUniversalRouter(UNIVERSAL_ROUTER)
            .execute(abi.encodePacked(UR_V4_SWAP), inputs, block.timestamp + 1 hours);
    }

    function _priceConfiguration() private pure returns (StockPairedLaunchV3.PriceConfiguration memory) {
        return StockPairedLaunchV3.PriceConfiguration({
            quoteAssets: _configuredAssets(), initialAbsoluteTicks: _configuredTicks()
        });
    }

    function _configuredAssets() private pure returns (address[6] memory assets) {
        assets[0] = 0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE;
        assets[1] = 0xFeDC5f4a6c38211c1338aa411018DFAf26612c08;
        assets[2] = 0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc;
        assets[3] = 0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4;
        assets[4] = 0xf6b1117ec07684D3958caD8BEb1b302bfD21103f;
        assets[5] = 0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c;
    }

    function _configuredTicks() private pure returns (int24[6] memory ticks) {
        ticks = [int24(181_200), int24(194_600), int24(186_800), int24(168_200), int24(185_600), int24(187_000)];
    }

    function _allRegistryAssets() private pure returns (address[] memory assets) {
        address[6] memory configured = _configuredAssets();
        assets = new address[](7);
        assets[0] = configured[0];
        assets[1] = configured[1];
        assets[2] = configured[2];
        assets[3] = configured[3];
        assets[4] = 0x0e397938C1Aa0680954093495B70A9F5e2249aBa;
        assets[5] = configured[4];
        assets[6] = configured[5];
    }

    function _allRegistrySymbolHashes() private pure returns (bytes32[] memory hashes) {
        hashes = new bytes32[](7);
        hashes[0] = keccak256("NVDAon");
        hashes[1] = keccak256("SPYon");
        hashes[2] = keccak256("GOOGLon");
        hashes[3] = keccak256("SLVon");
        hashes[4] = keccak256("QQQon");
        hashes[5] = keccak256("TSLAon");
        hashes[6] = keccak256("AAPLon");
    }

    function _configuredAssetList() private pure returns (address[] memory assets) {
        address[6] memory fixedAssets = _configuredAssets();
        assets = new address[](fixedAssets.length);
        for (uint256 index; index < fixedAssets.length; index++) {
            assets[index] = fixedAssets[index];
        }
    }

    function _routeFeesFixed() private pure returns (uint24[6] memory fees) {
        fees = [uint24(10_000), uint24(3000), uint24(10_000), uint24(10_000), uint24(10_000), uint24(10_000)];
    }

    function _routeFees() private pure returns (uint24[] memory fees) {
        uint24[6] memory fixedFees = _routeFeesFixed();
        fees = new uint24[](fixedFees.length);
        for (uint256 index; index < fixedFees.length; index++) {
            fees[index] = fixedFees[index];
        }
    }

    function _routePools() private pure returns (address[6] memory pools) {
        pools[0] = 0xf5294094BCe435bFbd0eC488be5C462aAF32Bc7A;
        pools[1] = 0x5638bbDE046EC2EFC7C8f3fd8DC5A9A1016f7EEB;
        pools[2] = 0x39FCB1935f6Ccb0A106D05eB928205C59646af57;
        pools[3] = 0xEeb8F880EAd7281A301ef2E6791A6bBe790603eD;
        pools[4] = 0x31227b50eCCDC9C589826AA2D9E7C5619B1895Da;
        pools[5] = 0xad82C9EB065a5CFed71DB087e4a52C8a09c69921;
    }

    function _routePoolCodeHashes() private pure returns (bytes32[6] memory hashes) {
        hashes[0] = 0x0c488df5bd90182f1e19b3c300eab4f99ab3c68d756250fd22589441b7c67e06;
        hashes[1] = 0x9ce9b74c4e3e51f9bcf2ad9d28f09df179f96f7d17e423aa9207a69dc1558252;
        hashes[2] = 0x1d93fa3dcce7502a231f47d3c9fcf22545d604735365a13d2b5823abd5ec85ee;
        hashes[3] = 0x78981bb1657e3a587ec8a74460e263f638f051511c62431b090277d38698ea79;
        hashes[4] = 0x8924e50b838c5e1ee3ec68c18a41e29c4d1403a03384f900c5659184e00d03d9;
        hashes[5] = 0x1ef0d1ec03b74d0240a743a2ac44941fad4401a3600a219afdc25f6b3d816b2a;
    }

    function _launcherQuoteAssetAt(uint256 index) private view returns (address) {
        if (index == 0) return launcher.quoteAsset0();
        if (index == 1) return launcher.quoteAsset1();
        if (index == 2) return launcher.quoteAsset2();
        if (index == 3) return launcher.quoteAsset3();
        if (index == 4) return launcher.quoteAsset4();
        return launcher.quoteAsset5();
    }

    function _asUint128(uint256 value) private pure returns (uint128) {
        assertLe(value, type(uint128).max);
        return uint128(value);
    }
}
