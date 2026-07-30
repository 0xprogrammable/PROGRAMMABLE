// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { PathKey } from "@uniswap/v4-periphery/src/libraries/PathKey.sol";
import { Test } from "forge-std/Test.sol";

import { QuoteAssetCreatorFeeHookV1 } from "../src/QuoteAssetCreatorFeeHookV1.sol";
import { QuoteAssetFeeSplitVaultV1 } from "../src/QuoteAssetFeeSplitVaultV1.sol";
import { StockPairedEthLaunchCoordinatorV1 } from "../src/StockPairedEthLaunchCoordinatorV1.sol";
import { StockPairedLaunchV1 } from "../src/StockPairedLaunchV1.sol";
import { StockQuoteRegistryV2 } from "../src/StockQuoteRegistryV2.sol";

interface IStockPairedV2UniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IStockPairedV2Permit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IStockPairedV2V3Quoter {
    function quoteExactInput(bytes calldata path, uint256 amountIn)
        external
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );
}

struct StockPairedV2ExactInputParams {
    Currency currencyIn;
    PathKey[] path;
    uint256[] minHopPriceX36;
    uint128 amountIn;
    uint128 amountOutMinimum;
}

/// @notice Exercises the exact Stock-Paired V2 contracts already deployed on Ethereum.
/// @dev The launch, trades and claims exist only inside the local fork and never reach Mainnet.
contract StockPairedV2DeployedMainnetForkTest is Test {
    uint256 internal constant FORK_BLOCK = 25_640_548;

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
    address internal constant V3_QUOTER = 0x61fFE014bA17989E743c5F6cB21bF9697530B21e;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    address internal constant QUOTE_REGISTRY = 0xd38Fbc171C1a842dc3F6d10cf5642BAe097D9239;
    address internal constant FEE_SPLIT_VAULT_FACTORY = 0x52d70971D6653a754c29385a2a6f241A481952d4;
    address internal constant FEE_HOOK = 0x90c67C1E866f86526F0e338459cD435E1F23A0cc;
    address internal constant LAUNCHER = 0x5eA6Be24838061bA45dbE8D82DE1b267DC240Daf;
    address internal constant ETH_LAUNCH_COORDINATOR = 0xFb9E1034df6161088E8F358502B19E7515c30fD2;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant BABA_ON = 0x41765F0FCddC276309195166C7A62AE522FA09ef;
    address internal constant ONDO_GM_TOKEN_MANAGER = 0x2c158BC456e027b2AfFCCadF1BDBD9f5fC4c5C8c;

    StockQuoteRegistryV2 internal quoteRegistry = StockQuoteRegistryV2(QUOTE_REGISTRY);
    QuoteAssetCreatorFeeHookV1 internal feeHook = QuoteAssetCreatorFeeHookV1(FEE_HOOK);
    StockPairedLaunchV1 internal launcher = StockPairedLaunchV1(LAUNCHER);
    StockPairedEthLaunchCoordinatorV1 internal coordinator = StockPairedEthLaunchCoordinatorV1(ETH_LAUNCH_COORDINATOR);

    address internal creator;
    address internal trader;

    function setUp() public {
        vm.createSelectFork(vm.envOr("ETHEREUM_RPC_URL", string("https://eth-mainnet.public.blastapi.io")), FORK_BLOCK);
        creator = makeAddr("deployedStockPairedV2ForkCreator");
        trader = makeAddr("deployedStockPairedV2ForkTrader");
    }

    function test_exactDeployedV2BindingsAndEconomics() public view {
        assertEq(quoteRegistry.assetCount(), 11);
        assertEq(address(quoteRegistry.gmTokenManager()), ONDO_GM_TOKEN_MANAGER);
        assertTrue(quoteRegistry.isSupported(BABA_ON));
        assertTrue(quoteRegistry.assertAssetReady(BABA_ON) != bytes32(0));

        assertEq(address(launcher.poolManager()), POOL_MANAGER);
        assertEq(address(launcher.positionManager()), POSITION_MANAGER);
        assertEq(address(launcher.quoteRegistry()), QUOTE_REGISTRY);
        assertEq(address(launcher.feeHook()), FEE_HOOK);
        assertEq(address(launcher.feeSplitVaultFactory()), FEE_SPLIT_VAULT_FACTORY);

        assertEq(address(feeHook.poolManager()), POOL_MANAGER);
        assertEq(address(feeHook.quoteRegistry()), QUOTE_REGISTRY);
        assertEq(feeHook.launcherFeeRecipient(), TREASURY);
        assertEq(feeHook.TOTAL_SWAP_FEE_BPS(), 100);
        assertEq(feeHook.CREATOR_FEE_BPS(), 90);
        assertEq(feeHook.LAUNCHER_FEE_BPS(), 10);
        assertEq(feeHook.TRANSFER_TAX_BPS(), 0);

        assertEq(address(coordinator.launcher()), LAUNCHER);
        assertEq(coordinator.stockPoolFee(BABA_ON), 10_000);
    }

    function test_exactDeployedV2CompletesEthLaunchTradeClaimsAndQuoteConversion() public {
        StockPairedLaunchV1.LaunchResult memory result = _launchBabaWithEth();
        PoolKey memory key = launcher.poolKey(result.token, BABA_ON);

        assertEq(result.quoteAsset, BABA_ON);
        assertGt(result.initialBuyQuoteAmount, launcher.MIN_INITIAL_BUY_QUOTE_AMOUNT());
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();

        uint256 traderTokens = _buyWithEth(key, result.token, 0.001 ether);
        _sellHalfForEth(key, result.token, traderTokens);

        (,,,,,, uint256 creatorFees) = feeHook.poolFeeConfig(result.poolId);
        uint256 launcherFees = feeHook.launcherFeesAccrued(BABA_ON);
        assertGt(creatorFees, 0);
        assertGt(launcherFees, 0);
        assertEq(feeHook.totalQuoteFeesAccrued(BABA_ON), creatorFees + launcherFees);
        assertEq(
            IPoolManager(POOL_MANAGER).balanceOf(FEE_HOOK, Currency.wrap(BABA_ON).toId()), creatorFees + launcherFees
        );

        uint256 creatorQuoteBefore = IERC20(BABA_ON).balanceOf(creator);
        vm.prank(creator);
        QuoteAssetFeeSplitVaultV1(result.rewardVault).claim();
        uint256 claimedQuote = IERC20(BABA_ON).balanceOf(creator) - creatorQuoteBefore;
        assertEq(claimedQuote, creatorFees);

        uint256 treasuryBefore = IERC20(BABA_ON).balanceOf(TREASURY);
        vm.prank(TREASURY);
        feeHook.claimLauncherFees(BABA_ON);
        assertEq(IERC20(BABA_ON).balanceOf(TREASURY) - treasuryBefore, launcherFees);
        assertEq(feeHook.totalQuoteFeesAccrued(BABA_ON), 0);

        uint256 quotedEth = _quoteV3(_sellV3Path(), claimedQuote);
        uint256 ethBefore = creator.balance;
        _convertQuoteToEth(creator, claimedQuote, quotedEth * 95 / 100);
        assertGt(creator.balance - ethBefore, quotedEth * 95 / 100);
        assertEq(IERC20(BABA_ON).balanceOf(UNIVERSAL_ROUTER), 0);
        assertEq(IERC20(WETH).balanceOf(UNIVERSAL_ROUTER), 0);
    }

    function _launchBabaWithEth() private returns (StockPairedLaunchV1.LaunchResult memory result) {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = creator;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        StockPairedLaunchV1.LaunchParameters memory launch = StockPairedLaunchV1.LaunchParameters({
            name: "Programmable V2 Fork Lifecycle",
            symbol: "V2FORK",
            quoteAsset: BABA_ON,
            initialBuyQuoteAmount: 0,
            creatorSalt: keccak256("programmable-stock-paired-v2-deployed-fork-lifecycle"),
            metadata: UERC20Metadata({
                description: "Local Mainnet-fork lifecycle proof",
                website: "https://programmable.family",
                image: "ipfs://programmable-stock-paired-v2-fork",
                extraData: bytes('{"v":2,"model":"stock-paired","environment":"local-fork"}')
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares
        });
        StockPairedEthLaunchCoordinatorV1.EthLaunchParameters memory parameters =
            StockPairedEthLaunchCoordinatorV1.EthLaunchParameters({
                minimumQuoteAmountOut: 1,
                minimumInitialTokenOut: 1,
                deadline: block.timestamp + 10 minutes,
                launch: launch
            });

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        result = coordinator.launch{ value: 0.01 ether }(parameters);
    }

    function _buyWithEth(PoolKey memory key, address token, uint256 ethAmount) private returns (uint256 received) {
        uint256 quoteAmount = _quoteV3(_buyV3Path(), ethAmount);
        uint256 tokenAmount = _quoteV4(key, true, quoteAmount);
        uint256 beforeBalance = IERC20(token).balanceOf(trader);

        bytes[] memory inputs = new bytes[](4);
        inputs[0] = abi.encode(ROUTER_AS_RECIPIENT, ethAmount);
        inputs[1] = _encodeV3ExactInput(ethAmount, 0, _buyV3Path());
        inputs[2] =
            _encodeV4ExactInput(key, BABA_ON, token, ROUTER_CONTRACT_BALANCE, _asUint128(tokenAmount * 95 / 100));
        inputs[3] = abi.encode(token, SENDER_AS_RECIPIENT, tokenAmount * 95 / 100);

        vm.deal(trader, 1 ether);
        vm.prank(trader);
        IStockPairedV2UniversalRouter(UNIVERSAL_ROUTER).execute{ value: ethAmount }(
            abi.encodePacked(UR_WRAP_ETH, UR_V3_SWAP_EXACT_IN, UR_V4_SWAP, UR_SWEEP),
            inputs,
            block.timestamp + 10 minutes
        );
        received = IERC20(token).balanceOf(trader) - beforeBalance;
        assertGt(received, tokenAmount * 95 / 100);
    }

    function _sellHalfForEth(PoolKey memory key, address token, uint256 traderTokens) private {
        _approveRouter(trader, token);
        uint256 amountIn = traderTokens / 2;
        uint256 quoteAmount = _quoteV4(key, false, amountIn);
        uint256 ethAmount = _quoteV3(_sellV3Path(), quoteAmount);
        uint256 beforeBalance = trader.balance;

        bytes[] memory inputs = new bytes[](5);
        inputs[0] = abi.encode(token, ROUTER_AS_RECIPIENT, _asUint160(amountIn));
        inputs[1] = _encodeV4ExactInput(key, token, BABA_ON, ROUTER_CONTRACT_BALANCE, 0);
        inputs[2] = _encodeV3ExactInput(ROUTER_CONTRACT_BALANCE, ethAmount * 95 / 100, _sellV3Path());
        inputs[3] = abi.encode(ROUTER_AS_RECIPIENT, ethAmount * 95 / 100);
        inputs[4] = abi.encode(address(0), SENDER_AS_RECIPIENT, ethAmount * 95 / 100);

        vm.prank(trader);
        IStockPairedV2UniversalRouter(UNIVERSAL_ROUTER)
            .execute(
                abi.encodePacked(UR_PERMIT2_TRANSFER_FROM, UR_V4_SWAP, UR_V3_SWAP_EXACT_IN, UR_UNWRAP_WETH, UR_SWEEP),
                inputs,
                block.timestamp + 10 minutes
            );
        assertGt(trader.balance - beforeBalance, ethAmount * 95 / 100);
    }

    function _convertQuoteToEth(address caller, uint256 amountIn, uint256 amountOutMinimum) private {
        _approveRouter(caller, BABA_ON);
        bytes[] memory inputs = new bytes[](4);
        inputs[0] = abi.encode(BABA_ON, ROUTER_AS_RECIPIENT, _asUint160(amountIn));
        inputs[1] = _encodeV3ExactInput(ROUTER_CONTRACT_BALANCE, amountOutMinimum, _sellV3Path());
        inputs[2] = abi.encode(ROUTER_AS_RECIPIENT, amountOutMinimum);
        inputs[3] = abi.encode(address(0), SENDER_AS_RECIPIENT, amountOutMinimum);

        vm.prank(caller);
        IStockPairedV2UniversalRouter(UNIVERSAL_ROUTER)
            .execute(
                abi.encodePacked(UR_PERMIT2_TRANSFER_FROM, UR_V3_SWAP_EXACT_IN, UR_UNWRAP_WETH, UR_SWEEP),
                inputs,
                block.timestamp + 10 minutes
            );
    }

    function _approveRouter(address owner, address token) private {
        vm.startPrank(owner);
        IERC20(token).approve(PERMIT2, type(uint256).max);
        IStockPairedV2Permit2(PERMIT2).approve(token, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
        vm.stopPrank();
    }

    function _quoteV3(bytes memory path, uint256 amountIn) private returns (uint256 amountOut) {
        (amountOut,,,) = IStockPairedV2V3Quoter(V3_QUOTER).quoteExactInput(path, amountIn);
        assertGt(amountOut, 0);
    }

    function _quoteV4(PoolKey memory key, bool zeroForOne, uint256 amountIn) private returns (uint256 amountOut) {
        (amountOut,) = IV4Quoter(V4_QUOTER)
            .quoteExactInputSingle(
                IV4Quoter.QuoteExactSingleParams({
                poolKey: key, zeroForOne: zeroForOne, exactAmount: _asUint128(amountIn), hookData: ""
            })
            );
        assertGt(amountOut, 0);
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
        StockPairedV2ExactInputParams memory swap = StockPairedV2ExactInputParams({
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

    function _buyV3Path() private pure returns (bytes memory) {
        return abi.encodePacked(WETH, uint24(500), USDC, uint24(10_000), BABA_ON);
    }

    function _sellV3Path() private pure returns (bytes memory) {
        return abi.encodePacked(BABA_ON, uint24(10_000), USDC, uint24(500), WETH);
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
