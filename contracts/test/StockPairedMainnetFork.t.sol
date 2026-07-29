// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { QuoteAssetCreatorFeeHookFactoryV1 } from "../src/QuoteAssetCreatorFeeHookFactoryV1.sol";
import { QuoteAssetCreatorFeeHookV1 } from "../src/QuoteAssetCreatorFeeHookV1.sol";
import { QuoteAssetFeeSplitVaultFactoryV1 } from "../src/QuoteAssetFeeSplitVaultFactoryV1.sol";
import { QuoteAssetFeeSplitVaultV1 } from "../src/QuoteAssetFeeSplitVaultV1.sol";
import { StockPairedLaunchV1 } from "../src/StockPairedLaunchV1.sol";
import {
    IUniswapV3FactoryLike,
    IUniswapV3SwapRouterLike,
    StockPairedEthLaunchCoordinatorV1
} from "../src/StockPairedEthLaunchCoordinatorV1.sol";
import { StockPairedPositionPlannerV1 } from "../src/StockPairedPositionPlannerV1.sol";
import { StockQuoteRegistryV1 } from "../src/StockQuoteRegistryV1.sol";

interface IStockPairedUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IStockPairedPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IStockPairedV3Quoter {
    function quoteExactInput(bytes calldata path, uint256 amountIn)
        external
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );
}

struct StockPairedExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    uint256 minHopPriceX36;
    bytes hookData;
}

struct StockPairedExactInputParamsV211 {
    Currency currencyIn;
    PathKey[] path;
    uint256[] minHopPriceX36;
    uint128 amountIn;
    uint128 amountOutMinimum;
}

contract StockPairedMainnetForkTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_635_535;
    uint256 internal constant INITIAL_BUY = 0.02 ether;
    uint256 internal constant TRADER_BUY = 0.005 ether;
    uint8 internal constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant SETTLE_ALL = 0x0c;
    uint8 internal constant TAKE_ALL = 0x0f;
    uint8 internal constant SETTLE = 0x0b;
    uint8 internal constant SWAP_EXACT_IN = 0x07;
    uint8 internal constant TAKE = 0x0e;
    uint8 internal constant UR_V3_SWAP_EXACT_IN = 0x00;
    uint8 internal constant UR_PERMIT2_TRANSFER_FROM = 0x02;
    uint8 internal constant UR_SWEEP = 0x04;
    uint8 internal constant UR_WRAP_ETH = 0x0b;
    uint8 internal constant UR_UNWRAP_WETH = 0x0c;
    uint8 internal constant UR_V4_SWAP = 0x10;
    uint256 internal constant ROUTER_CONTRACT_BALANCE = 1 << 255;
    address internal constant SENDER_AS_RECIPIENT = address(1);
    address internal constant ROUTER_AS_RECIPIENT = address(2);

    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant UNIVERSAL_ROUTER = 0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address internal constant POSITION_FORWARDER_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;
    address internal constant V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address internal constant V3_SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address internal constant V3_QUOTER = 0x61fFE014bA17989E743c5F6cB21bF9697530B21e;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant WETH_USDC_POOL = 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640;
    address internal constant SLV_USDC_POOL = 0xEeb8F880EAd7281A301ef2E6791A6bBe790603eD;

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
    bytes32 internal constant V3_QUOTER_CODE_HASH = 0x06148f47d0f41a68d3bc970030a7150e5d608cfbc28d372440a2e41ce543d92b;
    bytes32 internal constant WETH_CODE_HASH = 0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23;
    bytes32 internal constant USDC_CODE_HASH = 0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505;
    bytes32 internal constant WETH_USDC_POOL_CODE_HASH =
        0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4;
    bytes32 internal constant SLV_USDC_POOL_CODE_HASH =
        0x78981bb1657e3a587ec8a74460e263f638f051511c62431b090277d38698ea79;

    IPoolManager internal poolManager;
    StockQuoteRegistryV1 internal quoteRegistry;
    QuoteAssetCreatorFeeHookV1 internal feeHook;
    StockPairedLaunchV1 internal launcher;

    address internal creator;
    address internal trader;
    address internal treasury;

    function setUp() public {
        vm.createSelectFork(vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org")), SNAPSHOT_BLOCK);

        poolManager = IPoolManager(POOL_MANAGER);
        creator = makeAddr("stockPairedForkCreator");
        trader = makeAddr("stockPairedForkTrader");
        treasury = makeAddr("stockPairedForkTreasury");

        quoteRegistry = new StockQuoteRegistryV1(
            _assets(),
            _symbolHashes(),
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
        launcher = new StockPairedLaunchV1(
            poolManager,
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            feeHook,
            quoteRegistry,
            new StockPairedPositionPlannerV1(),
            vaultFactory,
            LockedPositionFeeForwarderFactoryV1(POSITION_FORWARDER_FACTORY)
        );
    }

    function test_allSevenReviewedOndoAssetsPassThePinnedRuntimeGate() public view {
        address[] memory assets = _assets();
        for (uint256 index; index < assets.length; index++) {
            assertEq(assets[index].codehash, TOKEN_CODE_HASH);
            assertEq(IERC20Metadata(assets[index]).decimals(), 18);
            assertEq(keccak256(bytes(IERC20Metadata(assets[index]).symbol())), _symbolHashes()[index]);
            assertTrue(quoteRegistry.assertAssetReady(assets[index]) != bytes32(0));
        }
    }

    function test_officialDependenciesMatchTheReviewedMainnetRuntime() public view {
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_CODE_HASH);
        assertEq(POSITION_MANAGER.codehash, POSITION_MANAGER_CODE_HASH);
        assertEq(V4_QUOTER.codehash, V4_QUOTER_CODE_HASH);
        assertEq(PERMIT2.codehash, PERMIT2_CODE_HASH);
        assertEq(UNIVERSAL_ROUTER.codehash, UNIVERSAL_ROUTER_CODE_HASH);
        assertEq(UERC20_FACTORY.codehash, UERC20_FACTORY_CODE_HASH);
        assertEq(POSITION_FORWARDER_FACTORY.codehash, POSITION_FORWARDER_FACTORY_CODE_HASH);
        assertEq(V3_FACTORY.codehash, V3_FACTORY_CODE_HASH);
        assertEq(V3_SWAP_ROUTER.codehash, V3_SWAP_ROUTER_CODE_HASH);
        assertEq(V3_QUOTER.codehash, V3_QUOTER_CODE_HASH);
        assertEq(WETH.codehash, WETH_CODE_HASH);
        assertEq(USDC.codehash, USDC_CODE_HASH);
        assertEq(WETH_USDC_POOL.codehash, WETH_USDC_POOL_CODE_HASH);
        assertEq(SLV_USDC_POOL.codehash, SLV_USDC_POOL_CODE_HASH);
    }

    function test_allSevenAssetsCompleteAtomicLaunchAgainstOfficialMainnetV4() public {
        address[] memory assets = _assets();
        for (uint256 index; index < assets.length; index++) {
            StockPairedLaunchV1.LaunchResult memory result = _launch(index, assets[index]);
            assertEq(result.quoteAsset, assets[index]);
            assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY());
            assertGt(result.initialBuyTokenAmount, 0);
            assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        }
    }

    function test_sixLiquidAssetsCompleteOneTransactionEthLaunchThroughOfficialV3AndV4() public {
        address[] memory assets = _ethRouteAssets();
        uint24[] memory stockPoolFees = _ethRoutePoolFees();
        StockPairedEthLaunchCoordinatorV1 coordinator = new StockPairedEthLaunchCoordinatorV1(
            launcher,
            IUniswapV3SwapRouterLike(V3_SWAP_ROUTER),
            IUniswapV3FactoryLike(V3_FACTORY),
            WETH,
            USDC,
            assets,
            stockPoolFees
        );
        vm.deal(creator, 1 ether);
        for (uint256 index; index < assets.length; index++) {
            address[] memory beneficiaries = new address[](1);
            beneficiaries[0] = creator;
            uint16[] memory shares = new uint16[](1);
            shares[0] = 10_000;
            StockPairedLaunchV1.LaunchParameters memory launchParameters = StockPairedLaunchV1.LaunchParameters({
                name: string.concat("Programmable ETH Stock Paired ", vm.toString(index)),
                symbol: string.concat("PSE", vm.toString(index)),
                quoteAsset: assets[index],
                initialBuyQuoteAmount: 0,
                creatorSalt: keccak256(abi.encode("stock-paired-eth-mainnet-fork", index)),
                metadata: UERC20Metadata({
                    description: "Atomic ETH Stock Paired Mainnet fork fixture",
                    website: "https://programmable.family",
                    image: "",
                    extraData: ""
                }),
                rewardBeneficiaries: beneficiaries,
                rewardSharesBps: shares
            });
            StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters =
                StockPairedEthLaunchCoordinatorV1.EthLaunchParameters({
                    minimumQuoteAmountOut: 1,
                    minimumInitialTokenOut: 1,
                    deadline: block.timestamp + 1 hours,
                    launch: launchParameters
                });

            vm.prank(creator);
            StockPairedLaunchV1.LaunchResult memory result = coordinator.launch{ value: 0.01 ether }(parameters);
            assertEq(result.quoteAsset, assets[index]);
            assertGt(result.initialBuyQuoteAmount, launcher.MIN_INITIAL_BUY_QUOTE_AMOUNT());
            assertGt(result.initialBuyTokenAmount, 0);
            assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
            assertEq(IERC20(result.token).balanceOf(address(coordinator)), 0);
            assertEq(IERC20(assets[index]).balanceOf(address(coordinator)), 0);
        }
    }

    function test_qqqEthLaunchFailsClosedBecauseTheUnsafeRouteIsNotConfigured() public {
        address[] memory assets = _ethRouteAssets();
        StockPairedEthLaunchCoordinatorV1 coordinator = new StockPairedEthLaunchCoordinatorV1(
            launcher,
            IUniswapV3SwapRouterLike(V3_SWAP_ROUTER),
            IUniswapV3FactoryLike(V3_FACTORY),
            WETH,
            USDC,
            assets,
            _ethRoutePoolFees()
        );
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        StockPairedLaunchV1.LaunchParameters memory launchParameters = StockPairedLaunchV1.LaunchParameters({
            name: "Programmable QQQ route guard",
            symbol: "PSQQQ",
            quoteAsset: _assets()[4],
            initialBuyQuoteAmount: 0,
            creatorSalt: bytes32("qqq-route-guard"),
            metadata: UERC20Metadata({
                description: "QQQ route guard Mainnet fork fixture",
                website: "https://programmable.family",
                image: "",
                extraData: ""
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares
        });
        StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters =
            StockPairedEthLaunchCoordinatorV1.EthLaunchParameters({
                minimumQuoteAmountOut: 1,
                minimumInitialTokenOut: 1,
                deadline: block.timestamp + 1 hours,
                launch: launchParameters
            });

        vm.deal(creator, 0.01 ether);
        vm.prank(creator);
        vm.expectPartialRevert(StockPairedEthLaunchCoordinatorV1.UnsupportedQuoteAsset.selector);
        coordinator.launch{ value: 0.01 ether }(parameters);
    }

    function test_slvCanaryLaunchMeetsTheQuoteMinimumWithPointZeroZeroZeroSixEth() public {
        address[] memory assets = _ethRouteAssets();
        StockPairedEthLaunchCoordinatorV1 coordinator = new StockPairedEthLaunchCoordinatorV1(
            launcher,
            IUniswapV3SwapRouterLike(V3_SWAP_ROUTER),
            IUniswapV3FactoryLike(V3_FACTORY),
            WETH,
            USDC,
            assets,
            _ethRoutePoolFees()
        );
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        StockPairedLaunchV1.LaunchParameters memory launchParameters = StockPairedLaunchV1.LaunchParameters({
            name: "Programmable SLV ETH canary",
            symbol: "SPETH",
            quoteAsset: assets[3],
            initialBuyQuoteAmount: 0,
            creatorSalt: bytes32("slv-eth-canary"),
            metadata: UERC20Metadata({
                description: "SLV ETH route Mainnet fork fixture",
                website: "https://programmable.family",
                image: "",
                extraData: ""
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares
        });
        StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters =
            StockPairedEthLaunchCoordinatorV1.EthLaunchParameters({
                minimumQuoteAmountOut: 1,
                minimumInitialTokenOut: 1,
                deadline: block.timestamp + 1 hours,
                launch: launchParameters
            });

        vm.deal(creator, 0.0006 ether);
        vm.prank(creator);
        StockPairedLaunchV1.LaunchResult memory result = coordinator.launch{ value: 0.0006 ether }(parameters);
        assertEq(result.quoteAsset, assets[3]);
        assertGt(result.initialBuyQuoteAmount, launcher.MIN_INITIAL_BUY_QUOTE_AMOUNT());
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
    }

    function test_slvCanaryCompletesAtomicEthBuyAndSellThroughOfficialUniversalRouter() public {
        address[] memory assets = _ethRouteAssets();
        StockPairedEthLaunchCoordinatorV1 coordinator = new StockPairedEthLaunchCoordinatorV1(
            launcher,
            IUniswapV3SwapRouterLike(V3_SWAP_ROUTER),
            IUniswapV3FactoryLike(V3_FACTORY),
            WETH,
            USDC,
            assets,
            _ethRoutePoolFees()
        );
        StockPairedLaunchV1.LaunchResult memory result = _launchEthCanary(coordinator, assets[3]);
        PoolKey memory key = launcher.poolKey(result.token, result.quoteAsset);

        uint256 ethBuyAmount = 0.0001 ether;
        vm.deal(trader, 0.01 ether);
        uint256 stockQuoted = _quoteV3(_buyV3Path(result.quoteAsset), ethBuyAmount);
        uint256 tokenQuoted = _quoteExactInput(key, result.quoteIsCurrency0, stockQuoted);
        uint256 tokenBefore = IERC20(result.token).balanceOf(trader);
        _executeAtomicEthBuy(
            trader, key, result.quoteAsset, result.token, ethBuyAmount, _asUint128(tokenQuoted * 95 / 100)
        );
        uint256 tokenAfterBuy = IERC20(result.token).balanceOf(trader);
        assertGt(tokenAfterBuy - tokenBefore, tokenQuoted * 95 / 100);

        _approveRouter(trader, result.token);
        uint256 sellAmount = (tokenAfterBuy - tokenBefore) / 2;
        uint256 stockSellQuoted = _quoteExactInput(key, !result.quoteIsCurrency0, sellAmount);
        uint256 ethSellQuoted = _quoteV3(_sellV3Path(result.quoteAsset), stockSellQuoted);
        uint256 ethBeforeSell = trader.balance;
        _executeAtomicEthSell(trader, key, result.token, result.quoteAsset, sellAmount, ethSellQuoted * 95 / 100);
        assertGt(trader.balance - ethBeforeSell, ethSellQuoted * 95 / 100);
        assertEq(IERC20(result.token).balanceOf(UNIVERSAL_ROUTER), 0);
        assertEq(IERC20(result.quoteAsset).balanceOf(UNIVERSAL_ROUTER), 0);
        assertEq(IERC20(WETH).balanceOf(UNIVERSAL_ROUTER), 0);

        (,,,,,, uint256 creatorFees) = feeHook.poolFeeConfig(result.poolId);
        assertGt(creatorFees, 0);
        assertGt(feeHook.launcherFeesAccrued(result.quoteAsset), 0);
    }

    function test_officialQuoterRouterAndClaimsCompleteLifecycleWhenQuoteIsCurrency0() public {
        _assertOfficialTradingLifecycle(4);
    }

    function test_officialQuoterRouterAndClaimsCompleteLifecycleWhenQuoteIsCurrency1() public {
        _assertOfficialTradingLifecycle(0);
    }

    function _assertOfficialTradingLifecycle(uint256 assetIndex) private {
        address quoteAsset = _assets()[assetIndex];
        StockPairedLaunchV1.LaunchResult memory result = _launch(assetIndex, quoteAsset);
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

        (,,,,,, uint256 creatorFees) = feeHook.poolFeeConfig(result.poolId);
        uint256 protocolFees = feeHook.launcherFeesAccrued(quoteAsset);
        assertGt(creatorFees, 0);
        assertGt(protocolFees, 0);
        assertEq(feeHook.totalQuoteFeesAccrued(quoteAsset), creatorFees + protocolFees);
        assertEq(poolManager.balanceOf(address(feeHook), Currency.wrap(quoteAsset).toId()), creatorFees + protocolFees);

        uint256 creatorBefore = IERC20(quoteAsset).balanceOf(creator);
        vm.prank(creator);
        QuoteAssetFeeSplitVaultV1(result.rewardVault).claim();
        assertEq(IERC20(quoteAsset).balanceOf(creator) - creatorBefore, creatorFees);

        uint256 treasuryBefore = IERC20(quoteAsset).balanceOf(treasury);
        vm.prank(treasury);
        feeHook.claimLauncherFees(quoteAsset);
        assertEq(IERC20(quoteAsset).balanceOf(treasury) - treasuryBefore, protocolFees);
        assertEq(feeHook.totalQuoteFeesAccrued(quoteAsset), 0);
    }

    function _launchEthCanary(StockPairedEthLaunchCoordinatorV1 coordinator, address quoteAsset)
        private
        returns (StockPairedLaunchV1.LaunchResult memory result)
    {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        StockPairedLaunchV1.LaunchParameters memory launchParameters = StockPairedLaunchV1.LaunchParameters({
            name: "Programmable SLV ETH router canary",
            symbol: "SPROUTE",
            quoteAsset: quoteAsset,
            initialBuyQuoteAmount: 0,
            creatorSalt: bytes32("slv-eth-router-canary"),
            metadata: UERC20Metadata({
                description: "Atomic ETH routing Mainnet fork fixture",
                website: "https://programmable.family",
                image: "",
                extraData: ""
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares
        });
        StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters =
            StockPairedEthLaunchCoordinatorV1.EthLaunchParameters({
                minimumQuoteAmountOut: 1,
                minimumInitialTokenOut: 1,
                deadline: block.timestamp + 1 hours,
                launch: launchParameters
            });

        vm.deal(creator, 0.0006 ether);
        vm.prank(creator);
        result = coordinator.launch{ value: 0.0006 ether }(parameters);
    }

    function _executeAtomicEthBuy(
        address caller,
        PoolKey memory key,
        address quoteAsset,
        address token,
        uint256 ethAmount,
        uint128 tokenAmountOutMinimum
    ) private {
        bytes[] memory inputs = new bytes[](4);
        inputs[0] = abi.encode(ROUTER_AS_RECIPIENT, ethAmount);
        inputs[1] = _encodeV3ExactInput(ethAmount, 0, _buyV3Path(quoteAsset));
        inputs[2] = _encodeV4ExactInput(key, quoteAsset, token, ROUTER_CONTRACT_BALANCE, tokenAmountOutMinimum);
        inputs[3] = abi.encode(token, SENDER_AS_RECIPIENT, uint256(tokenAmountOutMinimum));

        vm.prank(caller);
        IStockPairedUniversalRouter(UNIVERSAL_ROUTER).execute{ value: ethAmount }(
            abi.encodePacked(UR_WRAP_ETH, UR_V3_SWAP_EXACT_IN, UR_V4_SWAP, UR_SWEEP), inputs, block.timestamp + 1 hours
        );
    }

    function _executeAtomicEthSell(
        address caller,
        PoolKey memory key,
        address token,
        address quoteAsset,
        uint256 tokenAmount,
        uint256 ethAmountOutMinimum
    ) private {
        bytes[] memory inputs = new bytes[](5);
        inputs[0] = abi.encode(token, ROUTER_AS_RECIPIENT, _asUint160(tokenAmount));
        inputs[1] = _encodeV4ExactInput(key, token, quoteAsset, ROUTER_CONTRACT_BALANCE, 0);
        inputs[2] = _encodeV3ExactInput(ROUTER_CONTRACT_BALANCE, ethAmountOutMinimum, _sellV3Path(quoteAsset));
        inputs[3] = abi.encode(ROUTER_AS_RECIPIENT, ethAmountOutMinimum);
        inputs[4] = abi.encode(address(0), SENDER_AS_RECIPIENT, ethAmountOutMinimum);

        vm.prank(caller);
        IStockPairedUniversalRouter(UNIVERSAL_ROUTER)
            .execute(
                abi.encodePacked(UR_PERMIT2_TRANSFER_FROM, UR_V4_SWAP, UR_V3_SWAP_EXACT_IN, UR_UNWRAP_WETH, UR_SWEEP),
                inputs,
                block.timestamp + 1 hours
            );
    }

    function _encodeV3ExactInput(uint256 amountIn, uint256 amountOutMinimum, bytes memory path)
        private
        pure
        returns (bytes memory)
    {
        uint256[] memory minHopPriceX36 = new uint256[](0);
        return abi.encode(ROUTER_AS_RECIPIENT, amountIn, amountOutMinimum, path, false, minHopPriceX36);
    }

    function _encodeV4ExactInput(
        PoolKey memory key,
        address currencyIn,
        address currencyOut,
        uint256 settleAmount,
        uint128 amountOutMinimum
    ) private pure returns (bytes memory) {
        PathKey[] memory path = new PathKey[](1);
        path[0] = PathKey({
            intermediateCurrency: Currency.wrap(currencyOut),
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: IHooks(address(key.hooks)),
            hookData: ""
        });
        uint256[] memory minHopPriceX36 = new uint256[](0);
        StockPairedExactInputParamsV211 memory swap = StockPairedExactInputParamsV211({
            currencyIn: Currency.wrap(currencyIn),
            path: path,
            minHopPriceX36: minHopPriceX36,
            amountIn: 0,
            amountOutMinimum: amountOutMinimum
        });
        bytes[] memory actionParameters = new bytes[](3);
        actionParameters[0] = abi.encode(currencyIn, settleAmount, false);
        actionParameters[1] = abi.encode(swap);
        actionParameters[2] = abi.encode(currencyOut, ROUTER_AS_RECIPIENT, uint256(0));
        return abi.encode(abi.encodePacked(SETTLE, SWAP_EXACT_IN, TAKE), actionParameters);
    }

    function _quoteV3(bytes memory path, uint256 amountIn) private returns (uint256 amountOut) {
        (amountOut,,,) = IStockPairedV3Quoter(V3_QUOTER).quoteExactInput(path, amountIn);
        assertGt(amountOut, 0);
    }

    function _buyV3Path(address quoteAsset) private pure returns (bytes memory) {
        return abi.encodePacked(WETH, uint24(500), USDC, uint24(10_000), quoteAsset);
    }

    function _sellV3Path(address quoteAsset) private pure returns (bytes memory) {
        return abi.encodePacked(quoteAsset, uint24(10_000), USDC, uint24(500), WETH);
    }

    function _launch(uint256 index, address quoteAsset)
        private
        returns (StockPairedLaunchV1.LaunchResult memory result)
    {
        deal(quoteAsset, creator, 1 ether, true);
        vm.prank(creator);
        IERC20(quoteAsset).approve(address(launcher), INITIAL_BUY);

        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        StockPairedLaunchV1.LaunchParameters memory parameters = StockPairedLaunchV1.LaunchParameters({
            name: string.concat("Programmable Stock Paired ", vm.toString(index)),
            symbol: string.concat("PS", vm.toString(index)),
            quoteAsset: quoteAsset,
            initialBuyQuoteAmount: INITIAL_BUY,
            creatorSalt: keccak256(abi.encode("stock-paired-mainnet-fork", index)),
            metadata: UERC20Metadata({
                description: "Pinned Stock Paired Mainnet fork fixture",
                website: "https://programmable.family",
                image: "",
                extraData: ""
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares
        });

        vm.prank(creator);
        result = launcher.launch(parameters);
    }

    function _approveRouter(address owner, address token) private {
        vm.startPrank(owner);
        IERC20(token).approve(PERMIT2, type(uint256).max);
        IStockPairedPermit2(PERMIT2).approve(token, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
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
        StockPairedExactInputSingleParams memory swap = StockPairedExactInputSingleParams({
            poolKey: key,
            zeroForOne: zeroForOne,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            minHopPriceX36: 0,
            hookData: ""
        });

        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory actionParameters = new bytes[](3);
        actionParameters[0] = abi.encode(swap);
        actionParameters[1] = abi.encode(inputCurrency, uint256(amountIn));
        actionParameters[2] = abi.encode(outputCurrency, uint256(amountOutMinimum));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParameters);

        vm.prank(caller);
        IStockPairedUniversalRouter(UNIVERSAL_ROUTER)
            .execute(abi.encodePacked(UR_V4_SWAP), inputs, block.timestamp + 1 hours);
    }

    function _assets() private pure returns (address[] memory values) {
        values = new address[](7);
        values[0] = 0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE;
        values[1] = 0xFeDC5f4a6c38211c1338aa411018DFAf26612c08;
        values[2] = 0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc;
        values[3] = 0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4;
        values[4] = 0x0e397938C1Aa0680954093495B70A9F5e2249aBa;
        values[5] = 0xf6b1117ec07684D3958caD8BEb1b302bfD21103f;
        values[6] = 0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c;
    }

    function _symbolHashes() private pure returns (bytes32[] memory values) {
        values = new bytes32[](7);
        values[0] = keccak256("NVDAon");
        values[1] = keccak256("SPYon");
        values[2] = keccak256("GOOGLon");
        values[3] = keccak256("SLVon");
        values[4] = keccak256("QQQon");
        values[5] = keccak256("TSLAon");
        values[6] = keccak256("AAPLon");
    }

    function _ethRouteAssets() private pure returns (address[] memory values) {
        address[] memory registryAssets = _assets();
        values = new address[](6);
        values[0] = registryAssets[0];
        values[1] = registryAssets[1];
        values[2] = registryAssets[2];
        values[3] = registryAssets[3];
        values[4] = registryAssets[5];
        values[5] = registryAssets[6];
    }

    function _ethRoutePoolFees() private pure returns (uint24[] memory values) {
        values = new uint24[](6);
        values[0] = 10_000;
        values[1] = 3000;
        values[2] = 10_000;
        values[3] = 10_000;
        values[4] = 10_000;
        values[5] = 10_000;
    }

    function _asUint128(uint256 value) private pure returns (uint128) {
        assertLe(value, type(uint128).max);
        return uint128(value);
    }

    function _asUint160(uint256 value) private pure returns (uint160) {
        assertLe(value, type(uint160).max);
        return uint160(value);
    }
}
